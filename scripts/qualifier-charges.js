/**
 * Feuille de qualification des charges.
 *
 *     node scripts/qualifier-charges.js --company 1 [--json feuille.json]
 *
 * N'ÉCRIT RIEN EN BASE. Regroupe les écritures de nature CHARGE en lots, propose
 * une nature pour chacun, et laisse la décision au gérant.
 *
 * POURQUOI CETTE ÉTAPE EXISTE
 *
 * La reprise de la caisse a rangé en CHARGE tout ce qu'elle ne savait pas
 * qualifier : 606 lignes, 102 444 590 F. Le compte de résultat affichait donc
 * −64 344 518 F, ce qui n'était pas une perte mais un mauvais classement.
 *
 * Le classificateur d'origine ne regardait que le NOM du bénéficiaire. Or dans
 * ce registre, la nature de l'opération est dans la DESCRIPTION : « ALI —
 * Transfert vers le Liban » est un mouvement de fonds, pas une charge. Quarante
 * sept millions sont passés à travers de cette façon.
 *
 * LES RÈGLES SORTENT DES DONNÉES, PAS D'UNE THÉORIE
 *
 * Chaque motif ci-dessous a été lu dans les libellés réels avant d'être écrit.
 * L'ordre compte : la première règle qui correspond gagne, donc les cas les plus
 * spécifiques viennent d'abord.
 *
 * CE QUE LE GÉRANT DOIT TRANCHER
 *
 * Les lots marqués `arbitrage` ne se décident pas depuis les libellés. Un
 * transfert vers le Liban peut être un règlement de fournisseur de véhicules, un
 * mouvement vers un compte détenu ailleurs, ou un prélèvement personnel — et la
 * réponse change le résultat.
 */

require('dotenv').config();
const fs = require('node:fs');
const { prisma } = require('../src/lib/prisma');
const { runAsSystem } = require('../src/lib/context');
const { REGLES, classer, HORS_RESULTAT } = require('../src/lib/qualification');

const fcfa = (n) => `${Math.round(Number(n)).toLocaleString('fr-FR')} F`;
const sansAccent = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();


async function main() {
  const args = process.argv.slice(2);
  const valeur = (nom) => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : null;
  };
  const companyId = valeur('--company') ? Number(valeur('--company')) : null;
  const sortie = valeur('--json');
  if (!companyId) {
    console.error('--company est obligatoire.');
    process.exit(1);
  }

  for (let i = 1; i <= 8; i += 1) {
    try {
      await prisma.$queryRawUnsafe('select 1');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  const lignes = await runAsSystem(companyId, async () => {
    const e = await prisma.ledgerEntry.findMany({
      where: { nature: 'CHARGE' },
      select: { id: true, entryDate: true, label: true, amountFcfa: true },
      orderBy: { amountFcfa: 'asc' },
    });
    return e.map((x) => ({
      id: Number(x.id),
      date: x.entryDate.toISOString().slice(0, 10),
      label: x.label,
      montant: Math.abs(Number(x.amountFcfa)),
    }));
  });

  const total = lignes.reduce((s, x) => s + x.montant, 0);
  const lots = new Map();
  const orphelines = [];

  for (const l of lignes) {
    const r = classer(l.label);
    if (!r) {
      orphelines.push(l);
      continue;
    }
    if (!lots.has(r.code)) lots.set(r.code, { ...r, lignes: [], montant: 0 });
    const lot = lots.get(r.code);
    lot.lignes.push(l);
    lot.montant += l.montant;
  }

  const classes = [...lots.values()].sort((a, b) => b.montant - a.montant);

  console.log('='.repeat(78));
  console.log('FEUILLE DE QUALIFICATION DES CHARGES');
  console.log('='.repeat(78));
  console.log(`  ${lignes.length} lignes en nature CHARGE, ${fcfa(total)}`);
  console.log("  Aucune écriture n'est modifiée par ce script.");

  console.log('\nLOTS PROPOSÉS');
  console.log('-'.repeat(78));
  for (const lot of classes) {
    const marque = lot.arbitrage ? '   <- ARBITRAGE' : '';
    console.log(`\n  ${lot.code}${marque}`);
    console.log(
      `    ${lot.lignes.length} ligne(s)   ${fcfa(lot.montant)}   ` +
        `${Math.round((lot.montant / total) * 100)} %   nature proposée : ${lot.nature}`
    );
    console.log(`    ${lot.note}`);
    for (const l of lot.lignes.slice(0, 3)) {
      console.log(`      ${fcfa(l.montant).padStart(14)}  ${String(l.label).slice(0, 54)}`);
    }
    if (lot.lignes.length > 3) console.log(`      … et ${lot.lignes.length - 3} autres`);
  }

  if (orphelines.length) {
    const m = orphelines.reduce((s, x) => s + x.montant, 0);
    console.log(`\n\n  NON CLASSÉES : ${orphelines.length} ligne(s), ${fcfa(m)}`);
    console.log('  Aucune règle ne les couvre — à parcourir à la main.');
    for (const l of orphelines.slice(0, 12)) {
      console.log(`      ${fcfa(l.montant).padStart(14)}  ${String(l.label).slice(0, 54)}`);
    }
    if (orphelines.length > 12) console.log(`      … et ${orphelines.length - 12} autres`);
  }

  const sortant = classes
    .filter((l) => HORS_RESULTAT.includes(l.nature))
    .reduce((s, l) => s + l.montant, 0);

  console.log('\n\nEFFET SUR LE RÉSULTAT');
  console.log('-'.repeat(78));
  console.log(`  charges qui sortiraient du résultat   ${fcfa(sortant).padStart(18)}`);
  console.log(`  charges qui y resteraient             ${fcfa(total - sortant).padStart(18)}`);
  console.log(
    "\n  Ce n'est pas une amélioration comptable : c'est le même argent, rangé là\n" +
      "  où il appartient. Un transfert vers un compte détenu ailleurs n'a jamais\n" +
      '  été une charge.'
  );

  console.log('\n\nCOMMENT APPLIQUER');
  console.log('-'.repeat(78));
  console.log(
    '  Le grand livre est en écriture seule : rien ne se corrige. Chaque ligne à\n' +
      '  requalifier sera CONTRE-PASSÉE puis réémise avec sa nature — les deux\n' +
      "  écritures restent visibles et l'historique reste lisible.\n\n" +
      "  Tranchez d'abord les lots marqués ARBITRAGE, puis on applique."
  );
  console.log('='.repeat(78));

  if (sortie) {
    fs.writeFileSync(
      sortie,
      JSON.stringify(
        {
          etabliLe: new Date().toISOString(),
          total,
          lots: classes.map((l) => ({
            code: l.code,
            nature: l.nature,
            arbitrage: Boolean(l.arbitrage),
            note: l.note,
            montant: l.montant,
            ids: l.lignes.map((x) => x.id),
          })),
          nonClassees: orphelines,
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`\nFeuille écrite : ${sortie}`);
  }
}

module.exports = { REGLES, classer, HORS_RESULTAT };

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('[qualifier] échec :', e.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
