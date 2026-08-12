/**
 * Chargeur du registre de caisse — second volet de la reprise.
 *
 *     extract_caisse.py → tampon-caisse.json → report_caisse.js → load_caisse.js
 *
 *     node scripts/import/load_caisse.js --company 1
 *     node scripts/import/load_caisse.js --company 1 --axe-vehicule
 *     node scripts/import/load_caisse.js --company 1 --commit
 *
 * À BLANC PAR DÉFAUT, comme le chargeur du costing et pour la même raison : le
 * grand livre n'accepte ni modification ni suppression.
 *
 * CE QUE LA CAISSE APPORTE QUE LE COSTING N'AVAIT PAS
 *
 * Les ventes réelles, datées. Le costing ne portait qu'une colonne « prix de
 * vente », sans date ni encaissement. La caisse donne « Vente de TOYOTA RAV4
 * 2T3DFREV3EW150583 — 5 400 000 » au 8 juillet. C'est ce qui permettra à la
 * plateforme de calculer une marge réelle plutôt qu'une marge espérée.
 *
 * LES NATURES, ET POURQUOI ELLES COMPTENT
 *
 * Le classeur met tout dans deux colonnes : ce qui sort, ce qui entre. Le grand
 * livre distingue, parce que confondre fausse le résultat :
 *
 *   sorties   TRANSFERT    dépôts et virements — l'argent change de compte
 *             PREPARATION  réparation imputable à un véhicule
 *             CHARGE       frais généraux, non imputables
 *   entrées   VENTE        produit d'une vente
 *             REGLEMENT    avance ou solde sur une vente — hors résultat, la
 *                          vente ayant déjà été reconnue
 *             FINANCEMENT  emprunt — hors résultat
 *             AUTRE        fonds reçus sans qualification
 *
 * Sans cette séparation, 94 842 200 F de dépôts passeraient en charges et
 * autant d'encaissements de créances en chiffre d'affaires.
 *
 * LES DEUX DÉCISIONS OUVERTES, EN DRAPEAUX PLUTÔT QU'EN SUPPOSITIONS
 *
 * --axe-vehicule   Rattache les dépenses de caisse au véhicule qu'elles citent.
 *                  ÉTEINT par défaut : le costing a déjà fourni des réparations
 *                  pour 39 de ces véhicules, et un quart des montants coïncide
 *                  exactement. Allumer le drapeau gonfle le coût de revient
 *                  d'une part réelle mais inconnue. Éteint, la référence au
 *                  véhicule reste dans le libellé — donc trouvable par la
 *                  recherche universelle — mais n'entre pas dans le coût.
 *
 * --sans-regularisation  N'écrit pas les deux écritures qui font retomber le
 *                  solde sur celui du classeur. Par défaut elles sont écrites :
 *                  le solde déclaré est le seul vérifiable, c'est celui de la
 *                  caisse physique.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const { prisma } = require('../../src/lib/prisma');
const { runAsSystem } = require('../../src/lib/context');
const { postEntry } = require('../../src/lib/ledger');
const { findOrCreatePartner } = require('../../src/lib/partners');
const { estMouvement, verifierChaine } = require('./report_caisse');

const fcfa = (n) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const nb = (n) => (n == null ? 0 : n);

const sansAccent = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();

/* ── Arguments ────────────────────────────────────────────────────────────── */

function options() {
  const a = process.argv.slice(2);
  const valeur = (nom) => {
    const i = a.indexOf(nom);
    return i >= 0 ? a[i + 1] : null;
  };
  return {
    commit: a.includes('--commit'),
    axeVehicule: a.includes('--axe-vehicule'),
    sansRegularisation: a.includes('--sans-regularisation'),
    companyId: valeur('--company') ? Number(valeur('--company')) : null,
    tampon: valeur('--tampon') || path.join(__dirname, 'tampon-caisse.json'),
    journal: valeur('--journal') || path.join(__dirname, 'journal-caisse.json'),
  };
}

/* ── Classification des encaissements ─────────────────────────────────────── */

/**
 * Nature d'un encaissement, d'après son libellé.
 *
 * L'ordre des tests compte : « Solde sur vente de X » contient « vente », mais
 * c'est un encaissement de créance, pas une vente. On teste donc les formes
 * d'acompte AVANT la vente elle-même.
 */
function natureEncaissement(description) {
  const d = sansAccent(description);
  if (/^(AVANCE|SOLDE|RESTE|COMPLEMENT|VERSEMENT)\b/.test(d) || /\bAVANCE RECU\b/.test(d)) {
    return 'REGLEMENT';
  }
  if (/\bEMPRUNT\b|\bPRET\b/.test(d)) return 'FINANCEMENT';
  if (/^VENTE\b/.test(d)) return 'VENTE';
  return 'AUTRE';
}

/** Nature d'une dépense. */
function natureDepense(depense, vehicleId) {
  if (estMouvement(depense.prestataire)) return 'TRANSFERT';
  // PREPARATION exige un véhicule : sans axe, la dépense devient un frais
  // général. C'est moins juste sémantiquement, mais c'est la seule façon de ne
  // pas doubler un coût de revient déjà constitué.
  return vehicleId ? 'PREPARATION' : 'CHARGE';
}

/* ── Résolution des véhicules ─────────────────────────────────────────────── */

const MOTIF_VIN = /\b([A-Z0-9]{6,17})\b/g;

/**
 * Retrouve un véhicule cité dans un libellé.
 *
 * Le classeur écrit tantôt le châssis complet, tantôt ses six derniers
 * caractères. Les deux formes sont essayées, la plus longue d'abord.
 */
function resoudreVehicule(texte, parVin, parSuffixe) {
  const t = sansAccent(texte);
  const candidats = (t.match(MOTIF_VIN) || [])
    .filter((c) => /\d/.test(c))
    .sort((a, b) => b.length - a.length);
  for (const c of candidats) {
    if (c.length === 17 && parVin.has(c)) return parVin.get(c);
  }
  for (const c of candidats) {
    const suffixe = c.slice(-6);
    if (suffixe.length === 6 && parSuffixe.has(suffixe)) return parSuffixe.get(suffixe);
  }
  return null;
}

/* ── Construction du plan ─────────────────────────────────────────────────── */

function construirePlan(tampon, opts, vehicules) {
  const parVin = new Map();
  const parSuffixe = new Map();
  for (const v of vehicules) {
    if (!v.vin) continue;
    parVin.set(v.vin.toUpperCase(), v);
    parSuffixe.set(v.vin.slice(-6).toUpperCase(), v);
  }

  const journees = tampon.journees;
  const ecritures = [];
  const premier = journees[0];
  const dernier = journees[journees.length - 1];

  // Solde d'ouverture — la seule valeur du classeur qu'on reprend telle quelle,
  // faute d'avoir les mouvements qui l'ont produite.
  const ouverture = nb(premier.synthese.solde_reporte);
  if (ouverture) {
    ecritures.push({
      date: premier.date,
      nature: 'AUTRE',
      label: `Solde d'ouverture de la caisse au ${premier.date}`,
      montant: ouverture,
      categorie: 'OUVERTURE',
    });
  }

  for (const j of journees) {
    for (const d of j.depenses) {
      const vehicule = opts.axeVehicule
        ? resoudreVehicule(d.description || '', parVin, parSuffixe)
        : null;
      const nature = natureDepense(d, vehicule?.id);
      // Le véhicule cité reste dans le libellé même sans axe analytique : la
      // recherche universelle le retrouvera, le coût de revient l'ignorera.
      const label = [d.prestataire, d.description].filter(Boolean).join(' — ') || 'Dépense';
      ecritures.push({
        date: j.date,
        nature,
        label,
        montant: -Math.abs(nb(d.montant)),
        prestataire: estMouvement(d.prestataire) ? null : d.prestataire,
        vehicleId: vehicule?.id ?? null,
        categorie: nature === 'TRANSFERT' ? 'MOUVEMENT' : 'DEPENSE',
      });
    }

    for (const e of j.synthese.encaissements) {
      const nature = natureEncaissement(e.description);
      const vehicule = resoudreVehicule(e.description || '', parVin, parSuffixe);
      ecritures.push({
        date: j.date,
        nature,
        label: e.description || 'Encaissement',
        montant: Math.abs(nb(e.montant)),
        // Une vente et son encaissement portent le véhicule quel que soit le
        // drapeau : ils ne doublent aucun coût, ils constituent le produit.
        vehicleId: vehicule?.id ?? null,
        categorie: 'ENCAISSEMENT',
      });
    }
  }

  // Régularisations — deux, parce que les causes n'ont pas le même avenir.
  const regularisations = [];
  if (!opts.sansRegularisation) {
    const chaine = verifierChaine(journees);
    const manquante = chaine.anomalies.find((a) => a.code === 'JOURNEE_MANQUANTE');
    if (manquante) {
      regularisations.push({
        date: manquante.date,
        nature: 'AUTRE',
        label:
          `Régularisation — journée du ${manquante.date.replace(/^\d{4}-\d{2}-\d{2}$/, '')}` +
          `${(manquante.message.match(/du (\d{4}-\d{2}-\d{2})/) || [])[1] || ''} non saisie au classeur`,
        montant: manquante.montant,
        categorie: 'REGULARISATION',
      });
    }
    const autres =
      chaine.ecartReport - (manquante ? manquante.montant : 0) + chaine.ecartCalcul;
    if (Math.abs(autres) >= 1) {
      regularisations.push({
        date: dernier.date,
        nature: 'AUTRE',
        label: `Régularisation — écarts de report et de calcul du ${premier.date} au ${dernier.date}`,
        montant: autres,
        categorie: 'REGULARISATION',
      });
    }
  }

  return { ecritures: [...ecritures, ...regularisations], journees: journees.length };
}

/* ── Restitution ──────────────────────────────────────────────────────────── */

function resumer(plan, tampon, opts) {
  const dernier = tampon.journees[tampon.journees.length - 1];
  console.log('═'.repeat(78));
  console.log(
    opts.commit
      ? 'REPRISE DE LA CAISSE — ÉCRITURE RÉELLE'
      : 'REPRISE DE LA CAISSE — À BLANC, RIEN NE SERA ÉCRIT'
  );
  console.log('═'.repeat(78));
  console.log(
    `  axe véhicule sur les dépenses : ${opts.axeVehicule ? 'ACTIVÉ (--axe-vehicule)' : 'éteint'}`
  );
  console.log(
    `  écritures de régularisation   : ${opts.sansRegularisation ? 'omises' : 'écrites'}`
  );

  const parNature = {};
  for (const e of plan.ecritures) {
    parNature[e.nature] = parNature[e.nature] || { n: 0, entrees: 0, sorties: 0 };
    parNature[e.nature].n += 1;
    if (e.montant >= 0) parNature[e.nature].entrees += e.montant;
    else parNature[e.nature].sorties += -e.montant;
  }

  console.log(`\n  ${plan.ecritures.length} écritures sur ${plan.journees} journées\n`);
  console.log('    nature            n        entrées         sorties');
  for (const [nature, v] of Object.entries(parNature).sort(
    (a, b) => b[1].entrees + b[1].sorties - a[1].entrees - a[1].sorties
  )) {
    console.log(
      `    ${nature.padEnd(14)} ${String(v.n).padStart(4)} ` +
        `${(v.entrees ? fcfa(v.entrees) : '—').padStart(16)} ${(v.sorties ? fcfa(v.sorties) : '—').padStart(16)}`
    );
  }

  const solde = plan.ecritures.reduce((s, e) => s + e.montant, 0);
  console.log(`\n  Solde de la caisse après reprise : ${fcfa(solde)}`);
  console.log(`  Solde déclaré au ${dernier.date}         : ${fcfa(dernier.synthese.solde_final)}`);
  const ecart = solde - nb(dernier.synthese.solde_final);
  console.log(
    Math.abs(ecart) < 1
      ? '  → concordant.'
      : `  → ÉCART DE ${fcfa(ecart)} — le solde calculé ne retombe pas sur celui du classeur.`
  );

  const avecVehicule = plan.ecritures.filter((e) => e.vehicleId);
  const prep = plan.ecritures.filter((e) => e.nature === 'PREPARATION');
  console.log(
    `\n  ${avecVehicule.length} écritures portent un véhicule` +
      (prep.length ? `, dont ${prep.length} entrent dans un coût de revient` : ', aucune n\'entre dans un coût de revient')
  );
  if (prep.length) {
    const total = prep.reduce((s, e) => s + Math.abs(e.montant), 0);
    console.log(
      `  ATTENTION : ${fcfa(total)} viendront s'ajouter aux réparations déjà\n` +
        '  importées depuis le costing. Voir la section 3 du rapport de caisse.'
    );
  }

  const ventes = plan.ecritures.filter((e) => e.nature === 'VENTE');
  if (ventes.length) {
    const rattachees = ventes.filter((e) => e.vehicleId);
    const orphelines = ventes.filter((e) => !e.vehicleId);
    console.log(
      `\n  ${ventes.length} ventes reconnues — ${fcfa(ventes.reduce((s, e) => s + e.montant, 0))}`
    );
    console.log(
      `    rattachées à un véhicule en base  ${String(rattachees.length).padStart(3)}  ` +
        fcfa(rattachees.reduce((s, e) => s + e.montant, 0))
    );
    console.log(
      `    sur un véhicule INCONNU           ${String(orphelines.length).padStart(3)}  ` +
        fcfa(orphelines.reduce((s, e) => s + e.montant, 0))
    );
    if (orphelines.length) {
      console.log(
        "\n  Ces véhicules ne figurent dans AUCUN classeur de costing : le parc réel\n" +
          '  dépasse les 61 véhicules repris. Leur produit est connu, leur coût de\n' +
          '  revient ne l\'est nulle part — leur marge est donc incalculable.'
      );
      for (const e of orphelines.slice(0, 6)) {
        console.log(`      ${fcfa(e.montant).padStart(14)}  ${e.label.slice(0, 52)}`);
      }
      if (orphelines.length > 6) console.log(`      … et ${orphelines.length - 6} autres`);
    }
  }

  return { ecritures: plan.ecritures.length, solde };
}

/* ── Écriture ─────────────────────────────────────────────────────────────── */

async function appliquer(plan, opts) {
  const caisse = await prisma.cashAccount.findFirst({
    where: { nature: 'CAISSE' },
    orderBy: { id: 'asc' },
  });
  if (!caisse) throw new Error('aucun compte de trésorerie de nature CAISSE');

  // Idempotence : le solde d'ouverture est unique et reconnaissable. S'il est
  // déjà là, la reprise a déjà eu lieu — et rien ne s'efface.
  const deja = await prisma.ledgerEntry.findFirst({
    where: { cashAccountId: caisse.id, label: { startsWith: "Solde d'ouverture de la caisse" } },
  });
  if (deja) {
    throw new Error(
      `la reprise de la caisse a déjà été faite (écriture ${deja.id}). ` +
        'Le grand livre étant en écriture seule, il faut la contre-passer avant de recommencer.'
    );
  }

  const journal = { debut: new Date().toISOString(), options: opts, ecritures: [] };
  const partenaires = new Map();
  let n = 0;

  for (const e of plan.ecritures) {
    let partnerId = null;
    if (e.prestataire) {
      if (!partenaires.has(e.prestataire)) {
        const p = await findOrCreatePartner(e.prestataire, 'PRESTATAIRE');
        partenaires.set(e.prestataire, p.id);
      }
      partnerId = partenaires.get(e.prestataire);
    }

    const ecriture = await postEntry({
      nature: e.nature,
      label: e.label,
      amount: e.montant,
      currency: 'FCFA',
      rateApplied: 1,
      entryDate: e.date,
      vehicleId: e.vehicleId ?? null,
      cashAccountId: caisse.id,
      partnerId,
    });
    journal.ecritures.push({ id: Number(ecriture.id), date: e.date, nature: e.nature, montant: e.montant });
    n += 1;
  }

  journal.fin = new Date().toISOString();
  journal.totaux = { ecritures: n, tiers: partenaires.size, cashAccountId: caisse.id };
  fs.writeFileSync(opts.journal, JSON.stringify(journal, null, 2), 'utf8');

  console.log(`\n  ${n} écritures sur le compte « ${caisse.label} », ${partenaires.size} tiers.`);
  console.log(`  Journal : ${opts.journal}`);
  console.log('\n  Suite :  POST /alertes/evaluer');
}

/* ── Entrée ───────────────────────────────────────────────────────────────── */

async function main() {
  const opts = options();
  if (!fs.existsSync(opts.tampon)) {
    console.error(`Tampon introuvable : ${opts.tampon}`);
    process.exit(1);
  }
  const tampon = JSON.parse(fs.readFileSync(opts.tampon, 'utf8'));

  if (!opts.companyId) {
    console.error('--company est obligatoire : les écritures appartiennent à une société.');
    process.exit(1);
  }

  const vehicules = await runAsSystem(opts.companyId, async () => {
    return prisma.vehicle.findMany({ select: { id: true, vin: true } });
  });

  const plan = construirePlan(tampon, opts, vehicules);
  resumer(plan, tampon, opts);

  if (!opts.commit) {
    console.log(
      "\n  RIEN N'A ÉTÉ ÉCRIT. Pour appliquer :\n" +
        `      node scripts/import/load_caisse.js --company ${opts.companyId}` +
        `${opts.axeVehicule ? ' --axe-vehicule' : ''}` +
        `${opts.sansRegularisation ? ' --sans-regularisation' : ''} --commit`
    );
    console.log('═'.repeat(78));
    return;
  }

  await runAsSystem(opts.companyId, () => appliquer(plan, opts));
  console.log('═'.repeat(78));
}

module.exports = { construirePlan, natureEncaissement, natureDepense, resoudreVehicule };

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('\n[caisse] échec :', e.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
