/**
 * Rapport d'anomalies du registre de caisse — second volet de la reprise.
 *
 *     extract_caisse.py  →  tampon-caisse.json  →  report_caisse.js  →  load_caisse.js
 *
 *     node scripts/import/report_caisse.js [--json fichier]
 *
 * N'ÉCRIT RIEN. Lit le tampon, et interroge la base en LECTURE SEULE pour
 * confronter la caisse à ce que la reprise du costing y a déjà mis.
 *
 * DEUX QUESTIONS, ET ELLES SONT DIFFÉRENTES
 *
 * 1. Le classeur se tient-il tout seul ? Chaque journée porte un solde reporté,
 *    des encaissements, des dépenses et un solde final. Le solde de clôture d'un
 *    jour doit être le report du lendemain. C'est vérifiable sans rien d'autre.
 *
 * 2. Que se passe-t-il si on l'ajoute à ce qui est déjà en base ? Les dépenses
 *    de caisse citent des véhicules, et le costing a déjà fourni des
 *    réparations pour ces mêmes véhicules. Importer les deux sans regarder
 *    doublerait une partie du coût de revient.
 *
 * La seconde question ne se tranche pas depuis les données : les deux registres
 * se recoupent partiellement, et aucun n'est inclus dans l'autre. Le rapport la
 * pose, la chiffre, et s'arrête là.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const { prisma } = require('../../src/lib/prisma');
const { runAsSystem } = require('../../src/lib/context');
const { slugify } = require('../../src/lib/partners');

const fcfa = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} F`);
/** Libellé du dernier jour effectivement renseigné. */
const precedent0 = () => 'dernier jour renseigné';
const nb = (n) => (n == null ? 0 : n);

/* ── 1. Cohérence interne du classeur ─────────────────────────────────────── */

/**
 * Vérifie la chaîne des soldes, jour après jour.
 *
 * C'est le contrôle qui donne son sens à la reprise : si le classeur ne se
 * déduit pas de ses propres lignes, le solde qu'il affiche n'est pas un solde,
 * c'est une opinion.
 */
function verifierChaine(journees) {
  const anomalies = [];
  let precedent = null;
  let precedentVide = null; // date de la dernière journée sans aucune ligne
  let ecartReport = 0;
  let ecartCalcul = 0;

  for (const j of journees) {
    const depenses = j.depenses.reduce((s, d) => s + nb(d.montant), 0);
    const encaissements = j.synthese.encaissements.reduce((s, e) => s + nb(e.montant), 0);
    const report = j.synthese.solde_reporte;
    const declare = j.synthese.solde_final;

    if (!j.depenses.length && declare == null) {
      precedentVide = j.date;
      anomalies.push({ date: j.date, code: 'JOURNEE_VIDE', message: 'feuille sans aucune ligne' });
      continue;
    }

    if (j.total_declare != null && Math.abs(j.total_declare - depenses) >= 1) {
      anomalies.push({
        date: j.date,
        code: 'TOTAL_DU_JOUR_FAUX',
        message:
          `le total du jour annonce ${fcfa(j.total_declare)}, ` +
          `les lignes en totalisent ${fcfa(depenses)}`,
      });
    }

    if (precedent != null && report != null && Math.abs(report - precedent) >= 1) {
      const delta = report - precedent;
      ecartReport += delta;
      // Une rupture qui suit immédiatement une feuille vide n'est pas une
      // erreur de recopie : c'est la journée manquante qu'on lit en creux. Le
      // distinguer change tout — l'une se corrige, l'autre se ressaisit.
      const journeeManquante = precedentVide;
      anomalies.push({
        date: j.date,
        code: journeeManquante ? 'JOURNEE_MANQUANTE' : 'REPORT_ROMPU',
        montant: delta,
        message: journeeManquante
          ? `le report annonce ${fcfa(report)} alors que le ${precedent0(precedent)} close à ` +
            `${fcfa(precedent)} — les ${fcfa(Math.abs(delta))} manquants sont ceux du ` +
            `${journeeManquante}, dont la feuille est vide`
          : `le report annonce ${fcfa(report)} alors que la veille close à ${fcfa(precedent)} ` +
            `— ${delta > 0 ? '+' : '−'}${fcfa(Math.abs(delta))}`,
      });
    }
    precedentVide = null;

    if (report != null && declare != null) {
      const calcule = report + encaissements - depenses;
      if (Math.abs(calcule - declare) >= 1) {
        const delta = declare - calcule;
        ecartCalcul += delta;
        anomalies.push({
          date: j.date,
          code: 'SOLDE_DU_JOUR_FAUX',
          montant: delta,
          message:
            `solde annoncé ${fcfa(declare)}, calculé ${fcfa(calcule)} ` +
            `(${fcfa(report)} + ${fcfa(encaissements)} − ${fcfa(depenses)})`,
        });
      }
    }

    if (declare != null) precedent = declare;
  }

  return { anomalies, ecartReport, ecartCalcul };
}

/* ── 2. Recoupement avec ce qui est déjà en base ──────────────────────────── */

/** Intersection de deux multi-ensembles de montants. */
function communs(a, b) {
  const reste = [...b];
  let total = 0;
  let lignes = 0;
  for (const m of a) {
    const i = reste.indexOf(m);
    if (i >= 0) {
      total += m;
      lignes += 1;
      reste.splice(i, 1);
    }
  }
  return { total, lignes };
}

async function confronter(journees) {
  const vehicules = await prisma.vehicle.findMany({ select: { id: true, vin: true } });
  const parSuffixe = new Map();
  for (const v of vehicules) {
    if (v.vin) parSuffixe.set(v.vin.slice(-6).toUpperCase(), v);
  }

  const prep = await prisma.ledgerEntry.findMany({
    where: { nature: 'PREPARATION' },
    select: { vehicleId: true, amountFcfa: true },
  });
  const costing = new Map();
  for (const e of prep) {
    if (!costing.has(e.vehicleId)) costing.set(e.vehicleId, []);
    costing.get(e.vehicleId).push(Math.round(Math.abs(Number(e.amountFcfa))));
  }

  const caisse = new Map();
  let citantVehicule = 0;
  let citantInconnu = 0;
  let montantCitant = 0;
  let montantInconnu = 0;

  for (const j of journees) {
    for (const d of j.depenses) {
      if (!d.vins_courts.length) continue;
      citantVehicule += 1;
      montantCitant += nb(d.montant);
      const v = parSuffixe.get(d.vins_courts[0]);
      if (!v) {
        citantInconnu += 1;
        montantInconnu += nb(d.montant);
        continue;
      }
      if (!caisse.has(v.id)) caisse.set(v.id, []);
      caisse.get(v.id).push(Math.round(d.montant));
    }
  }

  const parId = Object.fromEntries(vehicules.map((v) => [v.id, v.vin]));
  const croisement = [];
  let totalCosting = 0;
  let totalCaisse = 0;
  let totalCommun = 0;

  for (const [id, montantsCaisse] of caisse) {
    const montantsCosting = costing.get(id) || [];
    if (!montantsCosting.length) continue;
    const inter = communs(montantsCaisse, montantsCosting);
    const sc = montantsCosting.reduce((a, b) => a + b, 0);
    const sk = montantsCaisse.reduce((a, b) => a + b, 0);
    totalCosting += sc;
    totalCaisse += sk;
    totalCommun += inter.total;
    croisement.push({
      vin: parId[id],
      costing: { lignes: montantsCosting.length, montant: sc },
      caisse: { lignes: montantsCaisse.length, montant: sk },
      commun: inter,
    });
  }

  croisement.sort((a, b) => b.commun.total - a.commun.total);

  return {
    citantVehicule,
    citantInconnu,
    montantCitant,
    montantInconnu,
    vehiculesCommuns: croisement.length,
    totalCosting,
    totalCaisse,
    totalCommun,
    croisement,
  };
}

/* ── 3. Nature réelle des lignes ──────────────────────────────────────────── */

/**
 * Toutes les lignes du registre ne sont pas des charges.
 *
 * La colonne « prestataire » sert aussi à noter les dépôts et virements :
 * « Dépôt CHAFTEL », « Dépot à ECOBANK ». Ce n'est pas une dépense, c'est de
 * l'argent qui change de compte — ou qui règle une facture fournisseur déjà
 * constatée. Les classer en charge gonflerait le résultat de la différence.
 *
 * La distinction n'est pas cosmétique : c'est exactement l'erreur que les
 * natures fermées du grand livre servent à empêcher (TRANSFERT et REGLEMENT
 * sont hors résultat).
 */
const MOTIF_MOUVEMENT = /^(DEPOT|VERSEMENT|VIREMENT|TRANSFERT|ALIMENTATION)\b/;

const sansAccent = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();

function estMouvement(prestataire) {
  return MOTIF_MOUVEMENT.test(sansAccent(prestataire));
}

function classer(journees) {
  const mouvements = { lignes: 0, montant: 0, beneficiaires: new Map() };
  const charges = { lignes: 0, montant: 0 };

  for (const j of journees) {
    for (const d of j.depenses) {
      const cible = estMouvement(d.prestataire) ? mouvements : charges;
      cible.lignes += 1;
      cible.montant += nb(d.montant);
      if (cible === mouvements) {
        const cle = sansAccent(d.prestataire).replace(/^\w+\s*(A|CHEZ)?\s*/, '') || d.prestataire;
        mouvements.beneficiaires.set(cle, (mouvements.beneficiaires.get(cle) || 0) + nb(d.montant));
      }
    }
  }
  return { mouvements, charges };
}

/* ── 4. Tiers ─────────────────────────────────────────────────────────────── */

async function tiers(journees) {
  const parSlug = new Map();
  for (const j of journees) {
    for (const d of j.depenses) {
      if (!d.prestataire) continue;
      const slug = slugify(d.prestataire);
      if (!slug) continue;
      if (!parSlug.has(slug)) parSlug.set(slug, { slug, graphies: new Set(), montant: 0, lignes: 0 });
      const t = parSlug.get(slug);
      t.graphies.add(d.prestataire);
      t.montant += nb(d.montant);
      t.lignes += 1;
    }
  }

  const existants = await prisma.partner.findMany({ select: { slug: true, name: true } });
  const connus = new Set(existants.map((p) => p.slug));

  const liste = [...parSlug.values()]
    .map((t) => ({ ...t, graphies: [...t.graphies], deja: connus.has(t.slug) }))
    .sort((a, b) => b.montant - a.montant);

  return { liste, nouveaux: liste.filter((t) => !t.deja).length, connus: connus.size };
}

/* ── Restitution ──────────────────────────────────────────────────────────── */

function titre(t) {
  console.log(`\n${t}`);
  console.log('─'.repeat(t.length));
}

function rendre(tampon, chaine, croise, tiersInfo, classement) {
  const journees = tampon.journees;
  const depenses = journees.reduce((s, j) => s + j.depenses.length, 0);
  const totalDepenses = journees.reduce(
    (s, j) => s + j.depenses.reduce((a, d) => a + nb(d.montant), 0),
    0
  );
  const totalEncaisse = journees.reduce(
    (s, j) => s + j.synthese.encaissements.reduce((a, e) => a + nb(e.montant), 0),
    0
  );
  const initial = journees[0].synthese.solde_reporte;
  const final = journees[journees.length - 1].synthese.solde_final;

  console.log('═'.repeat(78));
  console.log("RAPPORT DE REPRISE — REGISTRE DE CAISSE");
  console.log('═'.repeat(78));
  console.log(`Source  : ${tampon.source}`);
  console.log(`Période : du ${journees[0].date} au ${journees[journees.length - 1].date}`);
  console.log('Aucune écriture. La base n\'est lue que pour confronter les deux registres.');

  titre('1. CE QUE CONTIENT LE REGISTRE');
  console.log(`  journées            ${String(journees.length).padStart(5)}`);
  console.log(`  dépenses            ${String(depenses).padStart(5)}   ${fcfa(totalDepenses)}`);
  console.log(`  encaissements       ${String(journees.reduce((s, j) => s + j.synthese.encaissements.length, 0)).padStart(5)}   ${fcfa(totalEncaisse)}`);
  console.log(`  prestataires        ${String(tiersInfo.liste.length).padStart(5)}   dont ${tiersInfo.nouveaux} inconnus de la base`);

  titre('2. LE CLASSEUR SE TIENT-IL TOUT SEUL ?');
  const theorique = nb(initial) + totalEncaisse - totalDepenses;
  console.log(`  solde initial déclaré   ${fcfa(initial).padStart(16)}`);
  console.log(`  + encaissements         ${fcfa(totalEncaisse).padStart(16)}`);
  console.log(`  − dépenses              ${fcfa(totalDepenses).padStart(16)}`);
  console.log(`  ${'='.repeat(24)}${'='.repeat(16)}`);
  console.log(`  = solde théorique       ${fcfa(theorique).padStart(16)}`);
  console.log(`  solde final déclaré     ${fcfa(final).padStart(16)}`);
  console.log(`  ÉCART                   ${fcfa(theorique - final).padStart(16)}`);

  console.log('\n  Décomposition de l\'écart :');
  console.log(`    reports qui ne reprennent pas le solde de la veille  ${fcfa(-chaine.ecartReport).padStart(16)}`);
  console.log(`    soldes du jour mal calculés                         ${fcfa(-chaine.ecartCalcul).padStart(16)}`);
  const reste = theorique - final + chaine.ecartReport + chaine.ecartCalcul;
  console.log(`    inexpliqué                                          ${fcfa(reste).padStart(16)}`);

  const parCode = new Map();
  for (const a of chaine.anomalies) {
    if (!parCode.has(a.code)) parCode.set(a.code, []);
    parCode.get(a.code).push(a);
  }
  for (const [code, liste] of [...parCode.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ▸ ${code} — ${liste.length} cas`);
    for (const a of liste.slice(0, 6)) console.log(`      ${a.date}  ${a.message}`);
    if (liste.length > 6) console.log(`      … et ${liste.length - 6} autres`);
  }

  console.log(
    "\n  C'est exactement le défaut que la plateforme supprime : le solde d'ouverture\n" +
      "  y est calculé depuis le grand livre, jamais retapé. Aucune de ces ruptures\n" +
      '  ne peut s\'y produire.'
  );

  titre('3. RISQUE DE DOUBLE COMPTAGE AVEC LA REPRISE DU COSTING');
  console.log(
    `  ${croise.citantVehicule} dépenses citent un véhicule — ${fcfa(croise.montantCitant)}`
  );
  console.log(
    `  dont ${croise.citantInconnu} désignent un châssis absent de la base — ${fcfa(croise.montantInconnu)}`
  );
  console.log(`\n  ${croise.vehiculesCommuns} véhicules figurent dans LES DEUX registres :\n`);
  console.log('    châssis                    costing            caisse         identique');
  for (const c of croise.croisement.slice(0, 10)) {
    console.log(
      `    ${c.vin.padEnd(20)} ${(c.costing.lignes + ' l. ' + fcfa(c.costing.montant)).padStart(18)}` +
        ` ${(c.caisse.lignes + ' l. ' + fcfa(c.caisse.montant)).padStart(18)} ${fcfa(c.commun.total).padStart(14)}`
    );
  }
  if (croise.croisement.length > 10) {
    console.log(`    … et ${croise.croisement.length - 10} autres`);
  }
  console.log(`\n    ${'costing déjà en base'.padEnd(34)} ${fcfa(croise.totalCosting).padStart(16)}`);
  console.log(`    ${'caisse à importer'.padEnd(34)} ${fcfa(croise.totalCaisse).padStart(16)}`);
  console.log(
    `    ${'montants strictement identiques'.padEnd(34)} ${fcfa(croise.totalCommun).padStart(16)}` +
      `   soit ${Math.round((croise.totalCommun / croise.totalCaisse) * 100)} %`
  );

  console.log(
    "\n  Les deux registres se recoupent SANS que l'un contienne l'autre : le costing\n" +
      '  porte des réparations que la caisse ignore, la caisse en porte que le costing\n' +
      "  ignore, et un quart des montants coïncide. Aucune règle automatique ne peut\n" +
      '  trancher — la question est posée en section 6.'
  );

  titre('4. TOUTES LES LIGNES NE SONT PAS DES CHARGES');
  const { mouvements, charges } = classement;
  console.log(
    `  dépôts et virements  ${String(mouvements.lignes).padStart(4)} lignes  ${fcfa(mouvements.montant).padStart(16)}`
  );
  console.log(
    `  charges réelles      ${String(charges.lignes).padStart(4)} lignes  ${fcfa(charges.montant).padStart(16)}`
  );
  console.log('\n  Principaux bénéficiaires des mouvements :');
  for (const [nom, montant] of [...mouvements.beneficiaires.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)) {
    console.log(`      ${nom.slice(0, 28).padEnd(30)} ${fcfa(montant).padStart(16)}`);
  }
  console.log(
    "\n  Ces lignes ne sont pas des dépenses : l'argent change de compte, ou règle\n" +
      '  une facture fournisseur déjà constatée. Les classer en charge gonflerait le\n' +
      `  résultat de ${fcfa(mouvements.montant)}. Le grand livre a des natures pour cela —\n` +
      '  TRANSFERT et REGLEMENT, toutes deux hors résultat.'
  );

  titre('5. TIERS');
  console.log(`  ${tiersInfo.liste.length} prestataires, dont ${tiersInfo.nouveaux} inconnus de la base.\n`);
  for (const t of tiersInfo.liste.slice(0, 10)) {
    console.log(
      `    ${t.graphies[0].slice(0, 28).padEnd(30)} ${String(t.lignes).padStart(4)} l. ` +
        `${fcfa(t.montant).padStart(14)}  ${t.deja ? 'déjà en base' : 'nouveau'}`
    );
  }
  if (tiersInfo.liste.length > 10) console.log(`    … et ${tiersInfo.liste.length - 10} autres`);

  titre('6. CE QUI DOIT ÊTRE TRANCHÉ AVANT DE CHARGER');
  console.log(
    "  a) L'axe véhicule des dépenses de caisse.\n" +
      `     ${fcfa(croise.totalCaisse)} de dépenses de caisse portent sur des véhicules dont le\n` +
      '     costing a déjà fourni les réparations. Les importer avec l\'axe véhicule\n' +
      '     gonflerait le coût de revient d\'une part inconnue mais certaine.\n' +
      '\n' +
      "  b) L'écart de " + fcfa(theorique - final) + " entre le solde théorique et le solde déclaré.\n" +
      '     Le solde déclaré est le seul vérifiable — c\'est celui de la caisse\n' +
      '     physique. Le reprendre suppose une écriture de régularisation explicite.'
  );

  console.log('\n' + '═'.repeat(78));

  return {
    journees: journees.length,
    depenses,
    totalDepenses,
    totalEncaisse,
    soldeInitial: initial,
    soldeFinal: final,
    ecart: theorique - final,
    anomalies: chaine.anomalies.length,
  };
}

/* ── Entrée ───────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const iJson = args.indexOf('--json');
  const sortieJson = iJson >= 0 ? args[iJson + 1] : null;
  const chemin =
    args.find((a) => !a.startsWith('--') && a !== sortieJson) ||
    path.join(__dirname, 'tampon-caisse.json');

  if (!fs.existsSync(chemin)) {
    console.error(
      `Tampon introuvable : ${chemin}\n` +
        '  python scripts/import/extract_caisse.py "D:/Documents/Park auto" scripts/import/tampon-caisse.json'
    );
    process.exit(1);
  }

  const tampon = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  const chaine = verifierChaine(tampon.journees);

  const { croise, tiersInfo } = await runAsSystem(1, async () => {
    const c = await confronter(tampon.journees);
    const t = await tiers(tampon.journees);
    return { croise: c, tiersInfo: t };
  });

  const classement = classer(tampon.journees);
  const resume = rendre(tampon, chaine, croise, tiersInfo, classement);

  if (sortieJson) {
    fs.writeFileSync(
      sortieJson,
      JSON.stringify(
        {
          resume,
          chaine,
          croise,
          tiers: tiersInfo,
          classement: {
            mouvements: {
              lignes: classement.mouvements.lignes,
              montant: classement.mouvements.montant,
              beneficiaires: Object.fromEntries(classement.mouvements.beneficiaires),
            },
            charges: classement.charges,
          },
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`\nDétail complet : ${sortieJson}`);
  }
}

module.exports = { verifierChaine, communs, estMouvement, classer };

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('[caisse] échec :', e.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
