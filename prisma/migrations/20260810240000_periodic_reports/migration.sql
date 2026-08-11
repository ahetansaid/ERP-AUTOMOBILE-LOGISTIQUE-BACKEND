-- ============================================================================
-- Phase 5 — rapports périodiques et espace d'approbation
--
-- Le rapport quotidien remplace la feuille Excel du jour. Différence de fond :
-- son solde d'ouverture est CALCULÉ depuis le grand livre, jamais retapé. C'est
-- ce report manuel qui avait rompu la chaîne six fois dans les classeurs.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('GENERE','EN_REVUE','APPROUVE','A_CORRIGER','DIFFUSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportPeriodicity" AS ENUM ('QUOTIDIEN','HEBDOMADAIRE','MENSUEL','PONCTUEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Instantané figé : c'est LUI qui est approuvé. Sans lui, rouvrir un rapport
-- trois mois plus tard afficherait d'autres chiffres, et l'approbation ne
-- vaudrait plus rien.
ALTER TABLE "generated_reports"
  ADD COLUMN IF NOT EXISTS "periodicity"    "ReportPeriodicity" NOT NULL DEFAULT 'PONCTUEL',
  ADD COLUMN IF NOT EXISTS "status"         "ReportStatus"      NOT NULL DEFAULT 'GENERE',
  ADD COLUMN IF NOT EXISTS "payload"        JSONB,
  ADD COLUMN IF NOT EXISTS "approved_by"    INTEGER,
  ADD COLUMN IF NOT EXISTS "approved_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_note"    TEXT,
  ADD COLUMN IF NOT EXISTS "distributed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "idx_gr_status" ON "generated_reports" ("status");

-- Un seul rapport par société, type et période : régénérer met à jour plutôt
-- que d'empiler des doublons.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_gr_period"
  ON "generated_reports" ("company_id", "type", "period_start", "period_end");

-- Précisions, éventuellement ancrées à une ligne du rapport.
CREATE TABLE IF NOT EXISTS "report_comments" (
  "id"         SERIAL       PRIMARY KEY,
  "company_id" INTEGER      NOT NULL,
  "report_id"  INTEGER      NOT NULL REFERENCES "generated_reports"("id") ON DELETE CASCADE,
  "user_id"    INTEGER,
  "body"       TEXT         NOT NULL,
  -- Référence de la ligne visée dans le payload, ex. « operations.12 ».
  "anchor"     VARCHAR(120),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_rc_report"  ON "report_comments" ("report_id");
CREATE INDEX IF NOT EXISTS "idx_rc_company" ON "report_comments" ("company_id");
