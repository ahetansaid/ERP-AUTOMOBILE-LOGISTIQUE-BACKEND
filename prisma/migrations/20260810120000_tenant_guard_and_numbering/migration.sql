-- ============================================================================
-- Lot 1 — durcissement
--   1. Rôle PLATFORM_ADMIN (sépare l'éditeur du gérant de société)
--   2. Séquences de numérotation atomiques
--   3. Unicité du numéro de facture par société
-- ============================================================================

-- 1. ---------------------------------------------------------------------
-- Nouveau rôle. ADMIN désignait à la fois le gérant d'une société cliente et
-- l'administrateur de la plateforme ; seul le second doit pouvoir opérer sur
-- une autre société.
-- Note PostgreSQL : ALTER TYPE ... ADD VALUE ne peut pas être suivi d'un usage
-- de la nouvelle valeur dans la même transaction. Cette migration ne fait que
-- l'ajouter — l'attribution du rôle se fait ensuite, séparément.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';

-- 2. ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "document_counters" (
  "id"          SERIAL       PRIMARY KEY,
  "company_id"  INTEGER      NOT NULL,
  "doc_type"    VARCHAR(30)  NOT NULL,
  "year"        INTEGER      NOT NULL,
  "last_number" INTEGER      NOT NULL DEFAULT 0,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uk_counter_company_type_year"
  ON "document_counters" ("company_id", "doc_type", "year");

-- Amorce les compteurs à partir des factures déjà émises, pour que la
-- numérotation reprenne après le dernier numéro utilisé et ne réattribue pas
-- un numéro existant.
INSERT INTO "document_counters" ("company_id", "doc_type", "year", "last_number")
SELECT
  "company_id",
  'INVOICE',
  EXTRACT(YEAR FROM "created_at")::INT,
  COALESCE(MAX(NULLIF(REGEXP_REPLACE(RIGHT("invoice_number", 4), '\D', '', 'g'), '')::INT), 0)
FROM "invoices"
WHERE "company_id" IS NOT NULL
GROUP BY "company_id", EXTRACT(YEAR FROM "created_at")
ON CONFLICT ("company_id", "doc_type", "year") DO NOTHING;

-- 3. ---------------------------------------------------------------------
-- Unicité du numéro de facture par société.
-- Si cette contrainte échoue, c'est qu'il existe déjà des doublons produits par
-- l'ancienne numérotation non atomique. Les identifier avant de rejouer :
--
--   SELECT company_id, invoice_number, COUNT(*)
--   FROM invoices GROUP BY 1, 2 HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "uk_invoices_company_number"
  ON "invoices" ("company_id", "invoice_number");
