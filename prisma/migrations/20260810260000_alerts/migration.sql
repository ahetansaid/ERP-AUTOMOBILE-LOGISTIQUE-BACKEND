-- ============================================================================
-- Phase 6 — moteur d'alertes
--
-- Le moteur rejoue en continu l'audit fait à la main sur les classeurs :
-- coût de revient incomplet, dépense non imputée, taux incohérent, journée non
-- saisie, véhicule dormant. Ce que personne ne voit en feuilletant un tableur.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "AlertSeverity" AS ENUM ('INFO','ALERTE','CRITIQUE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AlertStatus" AS ENUM ('OUVERTE','RESOLUE','IGNOREE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Règles activées par la société. `code` désigne un évaluateur de la
-- bibliothèque ; `params` en règle les seuils.
CREATE TABLE IF NOT EXISTS "alert_rules" (
  "id"            SERIAL          PRIMARY KEY,
  "company_id"    INTEGER         NOT NULL,
  "code"          VARCHAR(60)     NOT NULL,
  "label"         VARCHAR(255)    NOT NULL,
  "severity"      "AlertSeverity" NOT NULL DEFAULT 'ALERTE',
  "enabled"       BOOLEAN         NOT NULL DEFAULT TRUE,
  "params"        JSONB,
  "channels"      TEXT[]          NOT NULL DEFAULT ARRAY['inapp'],
  "target_roles"  TEXT[]          NOT NULL DEFAULT '{}',
  "reminder_days" INTEGER         NOT NULL DEFAULT 7,
  "last_run_at"   TIMESTAMP(3),
  "created_at"    TIMESTAMP(3)    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uk_alert_rule_company_code"
  ON "alert_rules" ("company_id", "code");
CREATE INDEX IF NOT EXISTS "idx_alert_rule_company"
  ON "alert_rules" ("company_id");

-- Occurrences.
CREATE TABLE IF NOT EXISTS "alert_events" (
  "id"            BIGSERIAL       PRIMARY KEY,
  "company_id"    INTEGER         NOT NULL,
  "rule_id"       INTEGER         NOT NULL REFERENCES "alert_rules"("id") ON DELETE CASCADE,
  "severity"      "AlertSeverity" NOT NULL,
  "status"        "AlertStatus"   NOT NULL DEFAULT 'OUVERTE',
  "entity_type"   VARCHAR(50),
  "entity_id"     INTEGER,
  "title"         VARCHAR(255)    NOT NULL,
  "detail"        TEXT,
  "value"         DECIMAL(15,2),
  "first_seen_at" TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "last_seen_at"  TIMESTAMP(3)    NOT NULL DEFAULT NOW(),
  "notified_at"   TIMESTAMP(3),
  "resolved_at"   TIMESTAMP(3)
);

-- LA clé du moteur : une anomalie détectée à chaque passage met à jour son
-- occurrence au lieu d'en créer une nouvelle. Sans elle, une exécution horaire
-- produirait des centaines de doublons par semaine — panneau illisible, donc
-- ignoré, donc inutile.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_alert_event_key"
  ON "alert_events" ("company_id", "rule_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "idx_alert_event_status"
  ON "alert_events" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_alert_event_rule"
  ON "alert_events" ("rule_id");
