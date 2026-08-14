/**
 * Purge des écritures de test du grand livre.
 *
 *     node scripts/purge-ecritures-de-test.js --company 1
 *     node scripts/purge-ecritures-de-test.js --company 1 --commit
 *
 * OPÉRATION EXCEPTIONNELLE, ET ELLE DOIT LE RESTER.
 *
 * Le grand livre est en écriture seule, garanti par le déclencheur PostgreSQL
 * `trg_ledger_append_only`. Ce script le désactive le temps de supprimer des
 * lignes nommément désignées, puis le remet. C'est la seule façon de retirer
 * quelque chose du grand livre, et ce n'est légitime que dans un cas : des
 * écritures qui ne viennent d'aucune source métier.
 *
 * En l'occurrence, quatre écritures produites par MES tests de bout en bout
 * pendant la vérification des migrations, avant la reprise de l'historique.
 * Elles portent le compte Caisse : elles apparaissent donc dans le journal de
 * trésorerie que le gérant consulte, sous les libellés « Test de bout en bout »
 * et « Verification declencheur ». Leur somme est nulle — le solde n'en dépend
 * pas — mais leur présence dans un journal comptable n'est pas défendable.
 *
 * TROIS GARDE-FOUS, PARCE QUE LE DÉCLENCHEUR EST BAISSÉ
 *
 *   1. Les lignes sont désignées par identifiant ET par libellé. Une ligne dont
 *      les deux ne concordent pas n'est pas touchée.
 *   2. Tout se joue dans UNE transaction : si la suppression échoue, le
 *      déclencheur est rétabli par le retour arrière.
 *   3. Le rétablissement est VÉRIFIÉ après coup, en tentant une modification
 *      qui doit échouer. Un déclencheur qu'on croit remis ne vaut rien.
 *
 * Le journal d'audit de ces écritures n'est PAS touché. Il porte la trace que
 * ces tests ont eu lieu, et cette trace est exacte.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const { prisma, prismaRaw } = require('../src/lib/prisma');
const { runAsSystem } = require('../src/lib/context');

/** Lignes visées. L'identifiant seul ne suffit pas : le libellé doit concorder. */
const VISEES = [
  { id: 1, label: 'Test de bout en bout' },
  { id: 2, label: 'Contre-passation — Test de bout en bout' },
  { id: 3, label: 'Verification declencheur' },
  { id: 4, label: 'Contre-passation — Verification declencheur' },
];

const FONCTION_DECLENCHEUR = `
CREATE OR REPLACE FUNCTION public.ledger_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION
    'ledger_entries est en écriture seule : contre-passez l''écriture au lieu de la modifier';
END;
$function$`;

const fcfa = (n) => `${Math.round(Number(n)).toLocaleString('fr-FR')} F`;

function options() {
  const a = process.argv.slice(2);
  const valeur = (nom) => {
    const i = a.indexOf(nom);
    return i >= 0 ? a[i + 1] : null;
  };
  return {
    commit: a.includes('--commit'),
    companyId: valeur('--company') ? Number(valeur('--company')) : null,
    journal: valeur('--journal') || path.join(__dirname, 'purge-ecritures-de-test.json'),
  };
}

async function reveiller() {
  for (let i = 1; i <= 6; i += 1) {
    try {
      await prismaRaw.$queryRawUnsafe('select 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error('base injoignable');
}

async function main() {
  const opts = options();
  if (!opts.companyId) {
    console.error('--company est obligatoire.');
    process.exit(1);
  }
  await reveiller();

  const ids = VISEES.map((v) => v.id);
  const lignes = await runAsSystem(opts.companyId, async () => {
    return prisma.ledgerEntry.findMany({
      where: { id: { in: ids.map((n) => BigInt(n)) } },
      orderBy: { id: 'asc' },
    });
  });

  console.log('═'.repeat(76));
  console.log(
    opts.commit
      ? 'PURGE DES ÉCRITURES DE TEST — SUPPRESSION RÉELLE'
      : 'PURGE DES ÉCRITURES DE TEST — À BLANC, RIEN NE SERA SUPPRIMÉ'
  );
  console.log('═'.repeat(76));

  /* ── Concordance ────────────────────────────────────────────────────────── */

  const concordantes = [];
  for (const visee of VISEES) {
    const ligne = lignes.find((l) => Number(l.id) === visee.id);
    if (!ligne) {
      console.log(`  #${visee.id}  ABSENTE — déjà purgée, ou jamais créée`);
      continue;
    }
    if (ligne.label !== visee.label) {
      console.error(
        `\n  #${visee.id} REFUSÉE : le libellé attendu était « ${visee.label} », ` +
          `la base porte « ${ligne.label} ».`
      );
      console.error('  Une autre écriture occupe cet identifiant. Rien ne sera supprimé.');
      process.exit(1);
    }
    concordantes.push(ligne);
    console.log(
      `  #${visee.id}  ${String(ligne.entryDate.toISOString().slice(0, 10))}  ` +
        `${ligne.label.padEnd(46)} ${fcfa(ligne.amountFcfa).padStart(12)}`
    );
  }

  if (!concordantes.length) {
    console.log('\n  Rien à purger.');
    console.log('═'.repeat(76));
    return;
  }

  const somme = concordantes.reduce((s, l) => s + Number(l.amountFcfa), 0);
  console.log(`\n  ${concordantes.length} écriture(s), somme ${fcfa(somme)}`);
  if (Math.abs(somme) >= 1) {
    console.error(
      '\n  REFUS : la somme des écritures visées n\'est pas nulle. Les supprimer\n' +
        '  déplacerait un solde. Contre-passez-les d\'abord.'
    );
    process.exit(1);
  }
  console.log('  Somme nulle : aucun solde ne bouge.');

  /* ── Effets de bord ─────────────────────────────────────────────────────── */

  const auditees = await prismaRaw.auditLog.count({
    where: { resource: 'LedgerEntry', resourceId: { in: ids } },
  });
  console.log(
    `\n  Journal d'audit : ${auditees} trace(s) nommant ces écritures — CONSERVÉE(S).\n` +
      "  Ces tests ont eu lieu ; la trace est exacte et n'a pas à disparaître."
  );

  if (!opts.commit) {
    console.log(
      "\n  RIEN N'A ÉTÉ SUPPRIMÉ. Pour appliquer :\n" +
        `      node scripts/purge-ecritures-de-test.js --company ${opts.companyId} --commit`
    );
    console.log('═'.repeat(76));
    return;
  }

  /* ── Suppression ────────────────────────────────────────────────────────── */

  fs.writeFileSync(
    opts.journal,
    JSON.stringify(
      {
        purgeLe: new Date().toISOString(),
        motif: 'écritures de test de bout en bout, antérieures à la reprise',
        lignes: concordantes.map((l) => ({
          ...l,
          id: Number(l.id),
          reversesId: l.reversesId == null ? null : Number(l.reversesId),
          amount: Number(l.amount),
          amountFcfa: Number(l.amountFcfa),
          rateApplied: l.rateApplied == null ? null : Number(l.rateApplied),
        })),
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\n  Copie conservée : ${opts.journal}`);

  // Une seule transaction : un échec rétablit le déclencheur par retour arrière.
  const supprimees = await prismaRaw.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('DROP TRIGGER trg_ledger_append_only ON ledger_entries');
    // La contre-passation référence l'originale : on retire les liens d'abord,
    // sinon la contrainte d'unicité sur reverses_id bloque l'ordre de suppression.
    const n = await tx.$executeRawUnsafe(
      `DELETE FROM ledger_entries WHERE id = ANY($1::bigint[])`,
      ids
    );
    await tx.$executeRawUnsafe(FONCTION_DECLENCHEUR);
    await tx.$executeRawUnsafe(
      `CREATE TRIGGER trg_ledger_append_only
         BEFORE DELETE OR UPDATE ON ledger_entries
         FOR EACH ROW EXECUTE FUNCTION ledger_append_only()`
    );
    return n;
  });

  console.log(`  ${supprimees} écriture(s) supprimée(s).`);

  /* ── Vérification du rétablissement ─────────────────────────────────────── */

  const present = await prismaRaw.$queryRawUnsafe(
    `select tgname from pg_trigger
     where tgrelid = 'ledger_entries'::regclass and not tgisinternal
       and tgname = 'trg_ledger_append_only'`
  );
  if (!present.length) {
    console.error('\n  ALERTE : le déclencheur n\'est PAS rétabli. Rétablissez-le sur-le-champ.');
    process.exit(1);
  }

  // Un déclencheur présent n'est pas forcément actif : on le met à l'épreuve.
  let refuse = false;
  try {
    await prismaRaw.$executeRawUnsafe(
      `UPDATE ledger_entries SET label = label WHERE id = (SELECT min(id) FROM ledger_entries)`
    );
  } catch (err) {
    refuse = /écriture seule/.test(err.message);
  }
  console.log(
    refuse
      ? '  Déclencheur rétabli et VÉRIFIÉ : une modification est refusée.'
      : '  ALERTE : le déclencheur ne refuse pas les modifications.'
  );
  if (!refuse) process.exit(1);

  console.log('═'.repeat(76));
}

main()
  .catch((e) => {
    console.error('\n[purge] échec :', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
