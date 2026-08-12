/**
 * Contrôle avant migration — LECTURE SEULE.
 *
 * Les migrations créent des index uniques. Un index unique échoue s'il existe
 * déjà des doublons, et Prisma marque alors la migration en échec : les
 * suivantes sont bloquées tant qu'elle n'est pas résolue. Sur une base de
 * production, mieux vaut le savoir avant.
 *
 *   node scripts/preflight.js
 *
 * Aucune écriture. Aucune modification de schéma.
 */

const { prismaRaw } = require('../src/lib/prisma');

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const ko = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

let bloquant = 0;

/** Une table absente n'est pas une erreur : la migration la créera. */
async function tableExiste(nom) {
  const r = await prismaRaw.$queryRaw`
    SELECT to_regclass(${`public.${nom}`}) IS NOT NULL AS existe
  `;
  return r[0]?.existe === true;
}

async function main() {
  console.log('\nContrôle avant migration — lecture seule\n');

  // ── Volumétrie ────────────────────────────────────────────────────────────
  console.log('Volumétrie actuelle');
  const tables = ['companies', 'users', 'vehicles', 'purchases', 'invoices',
    'receipts', 'clients', 'suppliers', 'workshop_quotes', 'transactions_tresorerie'];
  for (const t of tables) {
    if (!(await tableExiste(t))) { info(`${t.padEnd(26)} (absente)`); continue; }
    const r = await prismaRaw.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    info(`${t.padEnd(26)} ${String(r[0].n).padStart(6)}`);
  }

  // ── uk_invoices_company_number ────────────────────────────────────────────
  console.log('\nUnicité du numéro de facture par société');
  if (await tableExiste('invoices')) {
    const dup = await prismaRaw.$queryRaw`
      SELECT company_id, invoice_number, COUNT(*)::int AS n
      FROM invoices
      WHERE invoice_number IS NOT NULL
      GROUP BY 1, 2 HAVING COUNT(*) > 1
      ORDER BY n DESC LIMIT 20
    `;
    if (dup.length) {
      bloquant++;
      ko(`${dup.length} numéro(s) en double — la migration 1 échouera`);
      for (const d of dup) info(`société ${d.company_id} · ${d.invoice_number} × ${d.n}`);
      info('Corriger avant : renuméroter les doublons, ou les annuler.');
    } else ok('aucun doublon');
  } else info('table absente');

  // ── uk_partner_company_slug ───────────────────────────────────────────────
  // La reprise remonte clients, fournisseurs et prestataires dans un même
  // référentiel. Deux noms différents peuvent produire le même slug : la
  // migration absorbe le cas (ON CONFLICT DO NOTHING / DO UPDATE), mais il
  // faut savoir combien de fusions implicites auront lieu.
  console.log('\nRapprochements de tiers attendus');
  if (await tableExiste('clients')) {
    const collisions = await prismaRaw.$queryRaw`
      WITH noms AS (
        SELECT company_id, name FROM clients WHERE name IS NOT NULL
        UNION ALL SELECT company_id, name FROM suppliers WHERE name IS NOT NULL
        UNION ALL SELECT company_id, prestataire FROM workshop_quotes WHERE prestataire IS NOT NULL
      ), norm AS (
        SELECT company_id,
               btrim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) AS cle,
               name
        FROM noms
      )
      SELECT company_id, cle, COUNT(DISTINCT name)::int AS variantes
      FROM norm WHERE cle <> ''
      GROUP BY 1, 2 HAVING COUNT(DISTINCT name) > 1
      ORDER BY variantes DESC LIMIT 15
    `;
    if (collisions.length) {
      ok(`${collisions.length} nom(s) présentant plusieurs graphies — regroupés à l'import`);
      for (const c of collisions.slice(0, 8)) info(`« ${c.cle} » · ${c.variantes} graphies`);
    } else ok('aucune graphie multiple');
  } else info('tables absentes');

  // ── Énumérations déjà présentes ───────────────────────────────────────────
  console.log('\nValeurs d’énumération déjà en base');
  const enums = await prismaRaw.$queryRaw`
    SELECT t.typname AS type, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS valeurs
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname IN ('UserRole', 'UploadKind', 'EntryNature')
    GROUP BY 1
  `;
  for (const e of enums) {
    const attendues = {
      UserRole: ['PLATFORM_ADMIN', 'PARTNER'],
      UploadKind: ['FACTURE_NORMALISEE', 'RECU_NORMALISE', 'DOCUMENT_DOUANE'],
      EntryNature: ['REGLEMENT'],
    }[e.type] ?? [];
    const manquantes = attendues.filter((v) => !e.valeurs.includes(v));
    if (manquantes.length) info(`${e.type} : à ajouter → ${manquantes.join(', ')}`);
    else ok(`${e.type} : déjà complet`);
  }

  // ── Tables des nouvelles migrations ───────────────────────────────────────
  console.log('\nTables à créer');
  for (const t of ['document_counters', 'ledger_entries', 'cash_accounts',
    'cost_categories', 'partners', 'search_index', 'alert_rules',
    'alert_events', 'purchase_costs', 'report_comments']) {
    info(`${t.padEnd(22)} ${(await tableExiste(t)) ? 'déjà présente' : 'à créer'}`);
  }

  console.log('');
  if (bloquant) {
    console.log(`\x1b[31m${bloquant} point(s) bloquant(s) : corriger avant d'appliquer.\x1b[0m\n`);
    process.exitCode = 1;
  } else {
    console.log('\x1b[32mAucun obstacle. Les migrations peuvent être appliquées.\x1b[0m\n');
  }
}

main()
  .catch((e) => {
    console.error('\nContrôle interrompu :', e.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => prismaRaw.$disconnect());
