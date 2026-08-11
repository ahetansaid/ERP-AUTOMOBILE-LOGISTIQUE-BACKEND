-- ============================================================================
-- Phase 3 — index de recherche universelle
--
-- Une seule table pour toutes les entités : on tape un numéro quelconque et on
-- retrouve le dossier. Elle est maintenue automatiquement par l'extension
-- Prisma, donc elle ne peut pas se désynchroniser.
--
-- APRÈS cette migration, lancer une fois `POST /search/rebuild` : les entités
-- créées avant n'ont jamais traversé l'extension, elles ne sont donc pas encore
-- indexées.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "search_index" (
  "id"          BIGSERIAL    PRIMARY KEY,
  "company_id"  INTEGER      NOT NULL,
  "entity_type" VARCHAR(50)  NOT NULL,
  "entity_id"   INTEGER      NOT NULL,
  "label"       VARCHAR(255) NOT NULL,
  "subtitle"    VARCHAR(255),
  -- Identifiants exacts : VIN, six derniers caractères, n° de conteneur, de
  -- facture… C'est ce qui permet de taper « 852354 ».
  "identifiers" TEXT[]       NOT NULL DEFAULT '{}',
  "search_text" TEXT         NOT NULL DEFAULT '',
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- Une entité n'a qu'une entrée d'index par société.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_search_entity"
  ON "search_index" ("company_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "idx_search_company"
  ON "search_index" ("company_id");

-- GIN sur le tableau : la recherche par identifiant exact reste immédiate même
-- avec plusieurs dizaines de milliers d'entités.
CREATE INDEX IF NOT EXISTS "idx_search_identifiers"
  ON "search_index" USING GIN ("identifiers");

-- Recherche approchée sur le texte libre. pg_trgm est disponible sur Neon ;
-- si l'extension manque, l'index n'est pas créé et la recherche retombe sur
-- ILIKE — plus lente, mais fonctionnelle.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "idx_search_text_trgm"
    ON "search_index" USING GIN ("search_text" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_search_label_trgm"
    ON "search_index" USING GIN ("label" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm indisponible : recherche approchée en ILIKE';
END $$;
