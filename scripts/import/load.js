/**
 * Chargeur de la reprise — troisième et dernier temps.
 *
 *     extract.py  →  tampon.json  →  report.js  →  load.js
 *
 *     node scripts/import/load.js --company 1 --date-defaut 2026-01-15
 *     node scripts/import/load.js --company 1 --date-defaut 2026-01-15 --commit
 *
 * À BLANC PAR DÉFAUT. Sans `--commit`, rien n'est écrit : le script calcule
 * tout, affiche exactement ce qu'il ferait, et s'arrête. Ce n'est pas une
 * précaution de principe — le grand livre est en écriture seule, garanti par un
 * déclencheur PostgreSQL. Un import fautif ne se rattrape qu'en contre-passant
 * ligne à ligne.
 *
 * TROIS ARBITRAGES, ARRÊTÉS AVANT ÉCRITURE
 *
 * 1. Taux divergents (11 véhicules). Le taux du bloc COÛT fait foi : c'est
 *    celui attaché aux composants que l'on importe. Le bloc de répartition est
 *    un second calcul fait après coup. Chaque véhicule concerné le dit dans le
 *    libellé de son écriture d'achat.
 *
 * 2. Véhicules non chiffrables (5). Le véhicule est créé, avec son châssis et
 *    son conteneur, mais sans écriture de coût. La règle d'alerte
 *    COUT_INCOMPLET, déjà installée, le fera remonter. Perdre le véhicule
 *    serait perdre plus que son coût.
 *
 * 3. Réparations. Le DÉTAIL des interventions fait foi, pas la colonne : chaque
 *    intervention devient une écriture portant son prestataire et son motif,
 *    donc recoupable. La valeur 670 000 F qui revient sur neuf véhicules
 *    ressemble à un forfait prévisionnel, pas à une dépense constatée. Quand il
 *    n'existe aucun détail, la colonne est reprise en une écriture unique, dite
 *    telle quelle.
 *
 * CE QUI N'EST PAS IMPORTÉ
 *
 * Le coût total du classeur. L'engagement E1 dit que rien de calculable n'est
 * saisi : le coût de revient est une somme d'écritures. Le total du classeur
 * reste un point de comparaison, écrit dans le journal de reprise.
 *
 * La trésorerie. Cette reprise reconstitue des COÛTS, pas des décaissements :
 * aucune écriture ne porte de compte de caisse. La caisse se reprend
 * séparément, à partir d'une date de coupure.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const { prisma } = require('../../src/lib/prisma');
const { runAsSystem } = require('../../src/lib/context');
const { postEntry } = require('../../src/lib/ledger');
const { findOrCreatePartner } = require('../../src/lib/partners');
const { analyser } = require('./report');

/* ── Arguments ────────────────────────────────────────────────────────────── */

function options() {
  const a = process.argv.slice(2);
  const valeur = (nom) => {
    const i = a.indexOf(nom);
    return i >= 0 ? a[i + 1] : null;
  };
  return {
    commit: a.includes('--commit'),
    companyId: valeur('--company') ? Number(valeur('--company')) : null,
    dateDefaut: valeur('--date-defaut'),
    tampon: valeur('--tampon') || path.join(__dirname, 'tampon.json'),
    journal: valeur('--journal') || path.join(__dirname, 'journal-reprise.json'),
  };
}

/* ── Outils ───────────────────────────────────────────────────────────────── */

const fcfa = (n) => `${Math.round(n).toLocaleString('fr-FR')} F`;

/**
 * « HYUNDAI ELANTRA » → marque HYUNDAI, modèle ELANTRA.
 * Le classeur ne sépare pas les deux ; le premier mot est la marque dans la
 * totalité des lignes observées.
 */
function marqueEtModele(libelle) {
  if (!libelle) return { brand: null, model: null };
  const mots = String(libelle).trim().split(/\s+/);
  return {
    brand: mots[0] || null,
    model: mots.slice(1).join(' ') || null,
  };
}

/** Nature de grand livre pour chaque composant de coût. */
const NATURE = {
  ACHAT: 'ACHAT',
  TRANSPORT_INTERNE: 'LOGISTIQUE',
  FRET: 'LOGISTIQUE',
  COMMISSION: 'LOGISTIQUE',
  DEPOTAGE: 'MANUTENTION',
  MAIN_OEUVRE: 'MANUTENTION',
  FRAIS_CONNEXE: 'MANUTENTION',
  IMV: 'TAXE',
};

const LIBELLE = {
  ACHAT: "Prix d'achat",
  TRANSPORT_INTERNE: 'Transport interne',
  FRET: 'Fret maritime',
  COMMISSION: 'Commission',
  DEPOTAGE: 'Dépotage',
  MAIN_OEUVRE: "Main d'œuvre portuaire",
  FRAIS_CONNEXE: 'Frais connexes',
  IMV: 'IMV',
};

/** Composants exprimés en devise — les autres sont déjà en FCFA. */
const EN_DEVISE = new Set(['ACHAT', 'TRANSPORT_INTERNE', 'FRET', 'COMMISSION']);

/* ── Construction du plan ─────────────────────────────────────────────────── */

/**
 * Traduit le tampon en une liste d'opérations, sans rien écrire.
 *
 * Le plan est la seule chose que `--commit` exécute : ce qui est affiché à
 * blanc et ce qui part en base sont produits par le même code, il ne peut donc
 * pas y avoir d'écart entre l'annonce et le résultat.
 */
function construirePlan(tampon, analyse, opts) {
  const bloquants = new Set(
    analyse.anomalies
      .filter((a) => a.niveau === 'BLOQUANT')
      .map((a) => a.cle)
  );
  const parVin = new Map(analyse.vehicules.map((v) => [v.vin, v]));

  const plan = { conteneurs: [], avertissements: [] };

  for (const conteneur of tampon.conteneurs) {
    const reference = conteneur.reference || conteneur.feuille;
    const date = conteneur.date || opts.dateDefaut;
    if (!conteneur.date) {
      plan.avertissements.push(
        `${reference} : aucune date dans le classeur, les écritures porteront le ${date}`
      );
    }

    const interventionsParVin = new Map();
    for (const i of conteneur.interventions) {
      if (!i.vin) continue;
      if (!interventionsParVin.has(i.vin)) interventionsParVin.set(i.vin, []);
      interventionsParVin.get(i.vin).push(i);
    }

    const vehicules = [];
    for (const v of conteneur.vehicules) {
      if (!v.vin || v.vin.length < 11) continue; // sans châssis, rien à rattacher
      const vue = parVin.get(v.vin);
      const taux = v.taux_bloc_cout ?? v.taux_bloc_repartition;

      // Arbitrage 1 : le taux du bloc coût fait foi, et on le dit.
      const tauxDivergent =
        v.taux_bloc_cout != null &&
        v.taux_bloc_repartition != null &&
        v.taux_bloc_cout !== v.taux_bloc_repartition;

      const ecritures = [];
      // Arbitrage 2 : sans prix d'achat ou sans taux, le véhicule est créé mais
      // ne reçoit aucune écriture de coût.
      const chiffrable = !bloquants.has(v.vin) && taux != null && v.achat_devise != null;

      if (chiffrable) {
        const composants = {
          ACHAT: v.achat_devise,
          TRANSPORT_INTERNE: v.transport_devise,
          FRET: v.fret_devise,
          COMMISSION: v.commission_devise,
          DEPOTAGE: v.depotage,
          MAIN_OEUVRE: v.main_oeuvre,
          FRAIS_CONNEXE: v.frais_connexe,
          IMV: v.imv,
        };
        for (const [type, montant] of Object.entries(composants)) {
          if (!montant) continue;
          const devise = EN_DEVISE.has(type);
          ecritures.push({
            type,
            nature: NATURE[type],
            label:
              type === 'ACHAT' && tauxDivergent
                ? `${LIBELLE[type]} — taux ${taux} retenu (le classeur en portait deux)`
                : LIBELLE[type],
            // Signe négatif : c'est une sortie. Le coût de revient est la somme
            // des valeurs absolues des natures de coût.
            amount: -Math.abs(montant),
            currency: devise ? 'USD' : 'FCFA',
            rateApplied: devise ? taux : 1,
            amountFcfa: -Math.abs(montant) * (devise ? taux : 1),
          });
        }
      }

      // Arbitrage 3 : le détail des interventions fait foi.
      const interventions = interventionsParVin.get(v.vin) || [];
      for (const i of interventions) {
        if (!i.montant) continue;
        ecritures.push({
          type: 'PREPARATION',
          nature: 'PREPARATION',
          label: (i.description || 'Réparation').slice(0, 255),
          prestataire: i.prestataire || null,
          amount: -Math.abs(i.montant),
          currency: 'FCFA',
          rateApplied: 1,
          amountFcfa: -Math.abs(i.montant),
        });
      }
      if (!interventions.length && v.reparation) {
        ecritures.push({
          type: 'PREPARATION',
          nature: 'PREPARATION',
          label: 'Réparation — reprise, sans détail dans le classeur',
          prestataire: null,
          amount: -Math.abs(v.reparation),
          currency: 'FCFA',
          rateApplied: 1,
          amountFcfa: -Math.abs(v.reparation),
        });
      }

      const { brand, model } = marqueEtModele(v.vehicule);
      vehicules.push({
        vin: v.vin,
        brand,
        model,
        year: Number.isInteger(v.annee) ? v.annee : null,
        // Un prix de vente renseigné signe une vente : le classeur ne le
        // remplit qu'une fois l'affaire faite.
        status: v.prix_vente != null ? 'VENDU' : 'DISPONIBLE',
        priceSale: v.prix_vente ?? null,
        purchasePrice: v.achat_devise ?? 0,
        purchasePriceFcfa: v.achat_devise != null && taux ? v.achat_devise * taux : null,
        countryOrigin: v.atelier === 'EURO' ? 'Europe' : v.atelier === 'USA' ? 'USA' : null,
        chiffrable,
        tauxRetenu: taux,
        tauxDivergent,
        coutClasseur: v.cout_total ?? null,
        coutRecalcule: vue?.coutRecalcule ?? null,
        ecritures,
      });
    }

    plan.conteneurs.push({
      reference,
      feuille: conteneur.feuille,
      date,
      dateDeduite: !conteneur.date,
      vehicules,
    });
  }

  return plan;
}

/* ── Restitution ──────────────────────────────────────────────────────────── */

function resumer(plan, opts) {
  const vehicules = plan.conteneurs.flatMap((c) => c.vehicules);
  const ecritures = vehicules.flatMap((v) => v.ecritures);
  const parNature = {};
  for (const e of ecritures) {
    parNature[e.nature] = parNature[e.nature] || { n: 0, montant: 0 };
    parNature[e.nature].n += 1;
    parNature[e.nature].montant += Math.abs(e.amountFcfa);
  }
  const prestataires = new Set(
    ecritures.map((e) => e.prestataire).filter(Boolean)
  );

  console.log('═'.repeat(78));
  console.log(
    opts.commit
      ? 'CHARGEMENT DE LA REPRISE — ÉCRITURE RÉELLE'
      : 'CHARGEMENT DE LA REPRISE — À BLANC, RIEN NE SERA ÉCRIT'
  );
  console.log('═'.repeat(78));

  const muets = vehicules.filter((v) => v.ecritures.length === 0);
  console.log(`\n  conteneurs           ${plan.conteneurs.length}`);
  console.log(`  véhicules            ${vehicules.length}`);
  console.log(`    coût d'achat repris ${vehicules.filter((v) => v.chiffrable).length}`);
  console.log(`    sans aucune écriture ${muets.length}`);
  console.log(`    vendus             ${vehicules.filter((v) => v.status === 'VENDU').length}`);
  console.log(`  prestataires         ${prestataires.size}`);
  console.log(`  écritures            ${ecritures.length}`);

  console.log('\n  Par nature :');
  let total = 0;
  for (const [nature, v] of Object.entries(parNature).sort((a, b) => b[1].montant - a[1].montant)) {
    total += v.montant;
    console.log(`    ${nature.padEnd(14)} ${String(v.n).padStart(4)}  ${fcfa(v.montant).padStart(16)}`);
  }
  console.log(`    ${''.padEnd(14)} ${''.padStart(4)}  ${'─'.repeat(16)}`);
  console.log(`    ${'TOTAL'.padEnd(14)} ${String(ecritures.length).padStart(4)}  ${fcfa(total).padStart(16)}`);

  const divergents = vehicules.filter((v) => v.tauxDivergent);
  if (divergents.length) {
    console.log(
      `\n  ${divergents.length} véhicule(s) portaient deux taux : celui du bloc coût est retenu,`
    );
    console.log("  et l'écriture d'achat le mentionne.");
  }

  const sansAchat = vehicules.filter((v) => !v.chiffrable);
  if (sansAchat.length) {
    console.log(`\n  ${sansAchat.length} véhicule(s) créés sans coût d'acquisition :`);
    for (const v of sansAchat) {
      const rep = v.ecritures.length
        ? `${v.ecritures.length} écriture(s) de préparation tout de même reprises`
        : 'aucune écriture';
      console.log(`      ${v.vin}  ${(v.brand || '') + ' ' + (v.model || '')} — ${rep}`);
    }
    console.log("  La règle d'alerte COUT_INCOMPLET les fera remonter.");
  }

  if (plan.avertissements.length) {
    console.log(`\n  ${plan.avertissements.length} conteneur(s) sans date au classeur :`);
    for (const a of plan.avertissements.slice(0, 5)) console.log(`      ${a}`);
    if (plan.avertissements.length > 5) {
      console.log(`      … et ${plan.avertissements.length - 5} autres`);
    }
  }

  // Écart avec le classeur : c'est le chiffre que le gérant va chercher.
  const compare = vehicules.filter((v) => v.coutClasseur != null && v.coutRecalcule != null);
  const ecart = compare.reduce((s, v) => s + (v.coutRecalcule - v.coutClasseur), 0);
  if (compare.length) {
    console.log(
      `\n  Sur ${compare.length} véhicules comparables, la plateforme affichera ` +
        `${fcfa(Math.abs(ecart))} ${ecart >= 0 ? 'de PLUS' : 'de MOINS'} que le classeur.`
    );
    console.log('  Le détail par véhicule est dans le rapport d\'anomalies.');
  }

  return { vehicules: vehicules.length, ecritures: ecritures.length, totalFcfa: total };
}

/* ── Écriture ─────────────────────────────────────────────────────────────── */

/**
 * Applique le plan. Idempotent par le châssis : un véhicule déjà présent est
 * sauté avec tout ce qui en dépend.
 *
 * C'est la seule protection possible contre un double import — le grand livre
 * n'accepte ni modification ni suppression, un doublon ne se corrige qu'en
 * contre-passant chaque ligne.
 */
async function appliquer(plan, opts) {
  const journal = { debut: new Date().toISOString(), conteneurs: [], sautes: [] };
  let nbVehicules = 0;
  let nbEcritures = 0;
  const partenaires = new Map();

  for (const c of plan.conteneurs) {
    const existant = await prisma.purchase.findFirst({
      where: { containerReference: c.reference },
    });
    const achat =
      existant ||
      (await prisma.purchase.create({
        data: {
          containerReference: c.reference,
          purchaseType: 'CONTENEUR',
          status: 'ARRIVE',
          currency: 'USD',
          purchaseDate: new Date(c.date),
          arrivalDate: new Date(c.date),
        },
      }));

    const trace = { reference: c.reference, purchaseId: achat.id, vehicules: [] };

    for (const v of c.vehicules) {
      const deja = await prisma.vehicle.findFirst({ where: { vin: v.vin } });
      if (deja) {
        journal.sautes.push({ vin: v.vin, motif: 'châssis déjà en base', vehicleId: deja.id });
        continue;
      }

      const vehicule = await prisma.vehicle.create({
        data: {
          vin: v.vin,
          brand: v.brand,
          model: v.model,
          year: v.year,
          status: v.status,
          priceSale: v.priceSale,
          purchasePrice: v.purchasePrice,
          purchasePriceFcfa: v.purchasePriceFcfa,
          countryOrigin: v.countryOrigin,
        },
      });
      nbVehicules += 1;

      await prisma.purchaseVehicle.create({
        data: { purchaseId: achat.id, vehicleId: vehicule.id },
      });

      const ids = [];
      for (const e of v.ecritures) {
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
          amount: e.amount,
          currency: e.currency,
          rateApplied: e.rateApplied,
          entryDate: c.date,
          vehicleId: vehicule.id,
          partnerId,
          source: { purchaseId: achat.id },
        });
        ids.push(Number(ecriture.id));
        nbEcritures += 1;
      }

      trace.vehicules.push({
        vin: v.vin,
        vehicleId: vehicule.id,
        ecritures: ids,
        coutClasseur: v.coutClasseur,
        coutRecalcule: v.coutRecalcule,
      });
    }

    journal.conteneurs.push(trace);
  }

  journal.fin = new Date().toISOString();
  journal.totaux = { vehicules: nbVehicules, ecritures: nbEcritures, partenaires: partenaires.size };
  fs.writeFileSync(opts.journal, JSON.stringify(journal, null, 2), 'utf8');

  console.log(`\n  ${nbVehicules} véhicules, ${nbEcritures} écritures, ${partenaires.size} tiers.`);
  if (journal.sautes.length) {
    console.log(`  ${journal.sautes.length} véhicule(s) sautés — châssis déjà en base.`);
  }
  console.log(`  Journal de reprise : ${opts.journal}`);
  console.log(
    '\n  Les identifiants de chaque écriture y sont consignés : c\'est ce qui\n' +
      '  permettra de contre-passer précisément cette reprise, et elle seule.'
  );
  console.log('\n  Suite :  POST /search/rebuild   puis   POST /alertes/evaluer');
}

/* ── Entrée ───────────────────────────────────────────────────────────────── */

async function main() {
  const opts = options();

  if (!fs.existsSync(opts.tampon)) {
    console.error(`Tampon introuvable : ${opts.tampon}`);
    process.exit(1);
  }
  const tampon = JSON.parse(fs.readFileSync(opts.tampon, 'utf8'));
  const analyse = analyser(tampon);

  const sansDate = tampon.conteneurs.filter((c) => !c.date).length;
  if (sansDate && !opts.dateDefaut) {
    console.error(
      `${sansDate} conteneurs sur ${tampon.conteneurs.length} n'ont pas de date au classeur.\n` +
        "Une écriture porte forcément une date, et prendre celle du jour daterait\n" +
        "l'historique d'aujourd'hui. Fixez-la explicitement :\n" +
        '  --date-defaut 2026-01-15'
    );
    process.exit(1);
  }
  if (opts.dateDefaut && Number.isNaN(Date.parse(opts.dateDefaut))) {
    console.error(`Date invalide : ${opts.dateDefaut} (attendu AAAA-MM-JJ)`);
    process.exit(1);
  }

  const plan = construirePlan(tampon, analyse, opts);
  resumer(plan, opts);

  if (!opts.commit) {
    console.log(
      "\n  RIEN N'A ÉTÉ ÉCRIT. Pour appliquer réellement :\n" +
        `      node scripts/import/load.js --company ${opts.companyId ?? 'N'} ` +
        `--date-defaut ${opts.dateDefaut || 'AAAA-MM-JJ'} --commit`
    );
    console.log('═'.repeat(78));
    return;
  }

  if (!opts.companyId) {
    console.error('\n  --company est obligatoire avec --commit : les écritures appartiennent');
    console.error('  à une société, et le filtre société refuse toute écriture hors contexte.');
    process.exit(1);
  }
  // Le `await` doit être DANS le contexte : une requête Prisma est paresseuse,
  // elle ne s'exécute qu'au moment où on l'attend. Renvoyer la promesse pour
  // l'attendre dehors la fait partir hors périmètre, et le filtre société la
  // refuse — ce qu'il a fait.
  const societe = await runAsSystem(null, async () => {
    return prisma.company.findFirst({ where: { id: opts.companyId } });
  });
  if (!societe) {
    console.error(`\n  Société ${opts.companyId} introuvable.`);
    process.exit(1);
  }

  console.log(`\n  Écriture dans la société ${societe.id} — ${societe.name}.`);
  await runAsSystem(opts.companyId, () => appliquer(plan, opts));
  console.log('═'.repeat(78));
}

// `construirePlan` est pur : il ne touche ni la base ni le disque. C'est ce qui
// permet de le tester, et donc de figer les trois arbitrages autrement que par
// une relecture du code.
module.exports = { construirePlan, marqueEtModele, NATURE };

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('\n[reprise] échec :', e.message);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
