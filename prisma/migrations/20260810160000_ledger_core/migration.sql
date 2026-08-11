-- ============================================================================
-- Lot 3 — noyau d'écritures à double axe
--
-- Tout mouvement est écrit UNE fois et porte deux axes : le véhicule (coût de
-- revient) et le compte de trésorerie (solde). Plus de recopie, donc plus de
-- divergence entre registres.
-- ============================================================================

-- 1. Natures système ---------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "EntryNature" AS ENUM (
    'ACHAT','LOGISTIQUE','TAXE','MANUTENTION','PREPARATION','VENTE',
    'CHARGE','FINANCEMENT','COMPTE_ASSOCIE','TRANSFERT','AUTRE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CashAccountNature" AS ENUM ('CAISSE','BANQUE','MOBILE_MONEY','AUTRE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Comptes de trésorerie ---------------------------------------------------
CREATE TABLE IF NOT EXISTS "cash_accounts" (
  "id"         SERIAL              PRIMARY KEY,
  "company_id" INTEGER             NOT NULL,
  "label"      VARCHAR(120)        NOT NULL,
  "nature"     "CashAccountNature" NOT NULL DEFAULT 'CAISSE',
  "currency"   VARCHAR(10)         NOT NULL DEFAULT 'FCFA',
  "is_active"  BOOLEAN             NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER             NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3)        NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uk_cash_account_company_label"
  ON "cash_accounts" ("company_id", "label");
CREATE INDEX IF NOT EXISTS "idx_cash_account_company"
  ON "cash_accounts" ("company_id");

-- 3. Catégories propres à chaque société -------------------------------------
CREATE TABLE IF NOT EXISTS "cost_categories" (
  "id"         SERIAL        PRIMARY KEY,
  "company_id" INTEGER       NOT NULL,
  "label"      VARCHAR(120)  NOT NULL,
  "nature"     "EntryNature" NOT NULL,
  "is_active"  BOOLEAN       NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER       NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3)  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uk_cost_category_company_label"
  ON "cost_categories" ("company_id", "label");
CREATE INDEX IF NOT EXISTS "idx_cost_category_company"
  ON "cost_categories" ("company_id");

-- 4. Grand livre -------------------------------------------------------------
-- `amount_fcfa` est SIGNÉ : négatif = sortie, positif = entrée. Un solde est
-- donc une somme, jamais une valeur saisie — c'est l'engagement E1.
CREATE TABLE IF NOT EXISTS "ledger_entries" (
  "id"                BIGSERIAL     PRIMARY KEY,
  "company_id"        INTEGER       NOT NULL,
  "entry_date"        DATE          NOT NULL,
  "nature"            "EntryNature" NOT NULL,
  "label"             VARCHAR(255)  NOT NULL,
  "amount"            DECIMAL(15,2) NOT NULL,
  "currency"          VARCHAR(10)   NOT NULL DEFAULT 'FCFA',
  "rate_applied"      DECIMAL(15,4),
  "amount_fcfa"       DECIMAL(15,2) NOT NULL,
  "vehicle_id"        INTEGER,
  "cash_account_id"   INTEGER REFERENCES "cash_accounts"("id") ON DELETE RESTRICT,
  "category_id"       INTEGER REFERENCES "cost_categories"("id") ON DELETE SET NULL,
  "purchase_id"       INTEGER,
  "invoice_id"        INTEGER,
  "receipt_id"        INTEGER,
  "workshop_quote_id" INTEGER,
  "charge_id"         INTEGER,
  "reverses_id"       BIGINT,
  "reversal_note"     TEXT,
  "correlation_id"    VARCHAR(64),
  "created_by"        INTEGER,
  "created_at"        TIMESTAMP(3)  NOT NULL DEFAULT NOW()
);

-- Une écriture ne peut être contre-passée qu'une seule fois.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_ledger_reverses"
  ON "ledger_entries" ("reverses_id");

CREATE INDEX IF NOT EXISTS "idx_ledger_company"     ON "ledger_entries" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_ledger_vehicle"     ON "ledger_entries" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_ledger_account_date" ON "ledger_entries" ("cash_account_id", "entry_date");
CREATE INDEX IF NOT EXISTS "idx_ledger_date"        ON "ledger_entries" ("entry_date");
CREATE INDEX IF NOT EXISTS "idx_ledger_nature"      ON "ledger_entries" ("nature");
CREATE INDEX IF NOT EXISTS "idx_ledger_correlation" ON "ledger_entries" ("correlation_id");

-- 5. Immuabilité au niveau de la base ---------------------------------------
-- L'extension Prisma refuse déjà update/delete, mais une connexion directe
-- (psql, outil d'admin) contournerait cette garantie. Le déclencheur la rend
-- indépendante du code applicatif.
CREATE OR REPLACE FUNCTION "ledger_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries est en écriture seule : contre-passez l''écriture au lieu de la modifier';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_ledger_append_only" ON "ledger_entries";
CREATE TRIGGER "trg_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
