-- ============================================================================
-- Lot 2 — pièces justificatives
--   1. Types d'upload pour les pièces fiscales externes
--   2. Références de la pièce externe sur les uploads
--   3. Numérotation des reçus
-- ============================================================================

-- 1. ---------------------------------------------------------------------
-- La plateforme ne certifie pas les documents : elle conserve la pièce établie
-- ailleurs et contrôle sa présence. Ces types la distinguent des PDF qu'elle
-- produit elle-même (INVOICE_PDF, RECEIPT_PDF…).
ALTER TYPE "UploadKind" ADD VALUE IF NOT EXISTS 'FACTURE_NORMALISEE';
ALTER TYPE "UploadKind" ADD VALUE IF NOT EXISTS 'RECU_NORMALISE';
ALTER TYPE "UploadKind" ADD VALUE IF NOT EXISTS 'DOCUMENT_DOUANE';

-- 2. ---------------------------------------------------------------------
-- Sans ces références, un fichier archivé n'est plus rapprochable du document
-- interne auquel il correspond.
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "doc_number" VARCHAR(100);
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "doc_date"   DATE;
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "doc_amount" DECIMAL(15,2);

CREATE INDEX IF NOT EXISTS "idx_uploads_doc_number" ON "uploads" ("doc_number");

-- 3. ---------------------------------------------------------------------
-- Les reçus n'avaient qu'une référence en texte libre. Devenus un document
-- propre à l'entreprise, ils ont besoin de leur propre séquence.
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "receipt_number" VARCHAR(50);

-- Numérote les reçus existants dans leur ordre de création, par société et par
-- année, pour que la séquence reprenne sans trou ni collision.
WITH numbered AS (
  SELECT
    "id",
    "company_id",
    EXTRACT(YEAR FROM "created_at")::INT AS yr,
    ROW_NUMBER() OVER (
      PARTITION BY "company_id", EXTRACT(YEAR FROM "created_at")
      ORDER BY "created_at", "id"
    ) AS seq
  FROM "receipts"
  WHERE "company_id" IS NOT NULL AND "receipt_number" IS NULL
)
UPDATE "receipts" r
SET "receipt_number" = 'REC-' || n.yr || '-' || LPAD(n.seq::TEXT, 4, '0')
FROM numbered n
WHERE r."id" = n."id";

-- Amorce les compteurs sur le dernier numéro attribué ci-dessus.
INSERT INTO "document_counters" ("company_id", "doc_type", "year", "last_number")
SELECT
  "company_id",
  'RECEIPT',
  EXTRACT(YEAR FROM "created_at")::INT,
  COUNT(*)
FROM "receipts"
WHERE "company_id" IS NOT NULL
GROUP BY "company_id", EXTRACT(YEAR FROM "created_at")
ON CONFLICT ("company_id", "doc_type", "year") DO NOTHING;

-- NULL est autorisé plusieurs fois par un index unique PostgreSQL : les reçus
-- antérieurs non numérotés (sans société) ne bloquent pas la contrainte.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_receipts_company_number"
  ON "receipts" ("company_id", "receipt_number");
