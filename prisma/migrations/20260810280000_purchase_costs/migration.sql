-- ============================================================================
-- Phase 8 — répartition des frais de conteneur et taux datés
--
-- Le chaînon qui manquait aux classeurs : le fret et la manutention y étaient
-- saisis globalement puis ventilés par une formule tapée à la main, avec des
-- clés et des taux qui variaient d'une ligne à l'autre au sein d'un même
-- conteneur. La règle devient un objet stocké, auditable et rejouable.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "PurchaseCostType" AS ENUM (
    'FRET','TRANSPORT_INTERNE','COMMISSION','DEPOTAGE',
    'MAIN_OEUVRE','FRAIS_CONNEXE','IMV','DOUANE','AUTRE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AllocationMode" AS ENUM (
    'PAR_VEHICULE','PRORATA_VALEUR','PRORATA_POIDS','MONTANT_FIXE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Poids du véhicule --------------------------------------------------------
-- Déjà présent sur vos connaissements (1 676 kg, 1 585 kg…), jamais exploité.
-- C'est la clé de répartition la plus juste pour le fret.
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "weight_kg" INTEGER;

-- 2. Frais de conteneur -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "purchase_costs" (
  "id"                SERIAL             PRIMARY KEY,
  "company_id"        INTEGER            NOT NULL,
  "purchase_id"       INTEGER            NOT NULL REFERENCES "purchases"("id") ON DELETE CASCADE,
  "type"              "PurchaseCostType" NOT NULL,
  "label"             VARCHAR(255),
  "amount"            DECIMAL(15,2)      NOT NULL,
  "currency"          VARCHAR(10)        NOT NULL DEFAULT 'FCFA',
  -- Taux FIGÉ à la saisie : un conteneur de mars reste converti au taux de mars.
  "rate_applied"      DECIMAL(15,4),
  "amount_fcfa"       DECIMAL(15,2)      NOT NULL,
  "allocation"        "AllocationMode"   NOT NULL DEFAULT 'PAR_VEHICULE',
  "allocation_detail" JSONB,
  "cost_date"         DATE               NOT NULL,
  "allocated_at"      TIMESTAMP(3),
  "created_at"        TIMESTAMP(3)       NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "idx_pcost_company"  ON "purchase_costs" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_pcost_purchase" ON "purchase_costs" ("purchase_id");

-- 3. Lien depuis le grand livre ----------------------------------------------
-- Permet de rejouer ou d'annuler une répartition entière.
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "purchase_cost_id" INTEGER;
CREATE INDEX IF NOT EXISTS "idx_ledger_pcost" ON "ledger_entries" ("purchase_cost_id");

DO $$ BEGIN
  ALTER TABLE "ledger_entries"
    ADD CONSTRAINT "fk_ledger_pcost"
    FOREIGN KEY ("purchase_cost_id") REFERENCES "purchase_costs"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Taux de change historisés ------------------------------------------------
-- Sans date d'effet, changer un taux recalculait rétroactivement tout
-- l'historique : le défaut même des classeurs, où le taux vivait dans la
-- formule et suivait donc chaque modification.
ALTER TABLE "exchange_rates"
  ADD COLUMN IF NOT EXISTS "effective_date" DATE NOT NULL DEFAULT CURRENT_DATE;

-- Les taux existants prennent effet à leur date de création : ils restent
-- applicables à tout l'historique déjà saisi.
UPDATE "exchange_rates"
SET "effective_date" = "created_at"::DATE
WHERE "effective_date" = CURRENT_DATE AND "created_at" IS NOT NULL;

DROP INDEX IF EXISTS "uk_er_company_currency";
CREATE UNIQUE INDEX IF NOT EXISTS "uk_er_company_currency_date"
  ON "exchange_rates" ("company_id", "currency", "effective_date");
