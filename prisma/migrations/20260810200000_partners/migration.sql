-- ============================================================================
-- Phase 2 — référentiel unifié des tiers
--
-- « Être un tiers » et « avoir un accès » deviennent deux choses distinctes.
-- Un prestataire existe et se mesure sans jamais se connecter ; un transitaire
-- pourra recevoir un accès limité à ses seuls dossiers.
--
-- Reprise incluse : clients, fournisseurs et prestataires existants sont
-- remontés dans le référentiel, avec rapprochement des graphies.
-- ============================================================================

-- 1. Types --------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "PartnerKind" AS ENUM (
    'CLIENT','FOURNISSEUR','PRESTATAIRE','TRANSITAIRE',
    'TRANSPORTEUR','ADMINISTRATION','AUTRE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PARTNER';

-- 2. Table --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "partners" (
  "id"           SERIAL         PRIMARY KEY,
  "company_id"   INTEGER        NOT NULL,
  "name"         VARCHAR(255)   NOT NULL,
  "slug"         VARCHAR(255)   NOT NULL,
  "kinds"        "PartnerKind"[] NOT NULL DEFAULT '{}',
  "specialty"    VARCHAR(120),
  "contact_name" VARCHAR(255),
  "email"        VARCHAR(255),
  "phone"        VARCHAR(50),
  "address"      TEXT,
  "city"         VARCHAR(100),
  "country"      VARCHAR(100),
  "legal_number" VARCHAR(100),
  "notes"        TEXT,
  "is_active"    BOOLEAN        NOT NULL DEFAULT TRUE,
  "created_at"   TIMESTAMP(3)   NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uk_partner_company_slug"
  ON "partners" ("company_id", "slug");
CREATE INDEX IF NOT EXISTS "idx_partner_company" ON "partners" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_partner_kinds"   ON "partners" USING GIN ("kinds");

-- 3. Rattachements ------------------------------------------------------------
-- Tous nullables : l'existant continue de fonctionner sans eux.
ALTER TABLE "clients"         ADD COLUMN IF NOT EXISTS "partner_id" INTEGER;
ALTER TABLE "suppliers"       ADD COLUMN IF NOT EXISTS "partner_id" INTEGER;
ALTER TABLE "workshop_quotes" ADD COLUMN IF NOT EXISTS "partner_id" INTEGER;
ALTER TABLE "ledger_entries"  ADD COLUMN IF NOT EXISTS "partner_id" INTEGER;
ALTER TABLE "users"           ADD COLUMN IF NOT EXISTS "partner_id" INTEGER;

CREATE INDEX IF NOT EXISTS "idx_clients_partner"   ON "clients" ("partner_id");
CREATE INDEX IF NOT EXISTS "idx_suppliers_partner" ON "suppliers" ("partner_id");
CREATE INDEX IF NOT EXISTS "idx_wq_partner"        ON "workshop_quotes" ("partner_id");
CREATE INDEX IF NOT EXISTS "idx_ledger_partner"    ON "ledger_entries" ("partner_id");
CREATE INDEX IF NOT EXISTS "idx_users_partner"     ON "users" ("partner_id");

-- 4. Fonction de normalisation ------------------------------------------------
-- Doit rester alignée sur slugify() de src/lib/partners.js.
-- Les mots de métier sont retirés (ils décrivent la fonction, pas la personne) ;
-- les suffixes de parc EURO/USA sont CONSERVÉS : rien ne dit encore s'il s'agit
-- d'une même personne sur deux parcs ou de deux homonymes. Mieux vaut deux
-- tiers fusionnables qu'un seul qu'on ne peut plus séparer.
-- Retire les accents sans dépendre de l'extension `unaccent`, absente de
-- certains hébergements gérés. Déclarée avant son appelante.
CREATE OR REPLACE FUNCTION "unaccent_safe"(txt TEXT) RETURNS TEXT AS $$
  SELECT translate(
    $1,
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
  );
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION "partner_slugify"(txt TEXT) RETURNS TEXT AS $$
DECLARE
  s TEXT;
BEGIN
  s := lower(unaccent_safe(coalesce(txt, '')));
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  s := regexp_replace(s, '\m(soudeur|soudure|peintre|peinture|mecanicien|mecanique|electricien|electricite|matelassier|matelasserie|frigoriste|vulganisateur|vulcanisateur|plasticien|plastique|minuteur|garage|atelier|monsieur|mr|mme)\M', ' ', 'g');
  s := regexp_replace(s, '\m\w\M', ' ', 'g');   -- mots d'une lettre
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  IF s = '' THEN
    s := btrim(regexp_replace(lower(unaccent_safe(coalesce(txt, ''))), '[^a-z0-9]+', ' ', 'g'));
  END IF;
  RETURN left(replace(s, ' ', '-'), 255);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 5. Reprise ------------------------------------------------------------------
-- 5a. Clients
INSERT INTO "partners" ("company_id", "name", "slug", "kinds", "contact_name", "email", "phone", "address", "city", "country")
SELECT DISTINCT ON (c."company_id", "partner_slugify"(c."name"))
  c."company_id", c."name", "partner_slugify"(c."name"), ARRAY['CLIENT']::"PartnerKind"[],
  c."contact_name", c."email", c."phone", c."address", c."city", c."country"
FROM "clients" c
WHERE c."company_id" IS NOT NULL AND btrim(coalesce(c."name", '')) <> ''
ORDER BY c."company_id", "partner_slugify"(c."name"), c."id"
ON CONFLICT ("company_id", "slug") DO NOTHING;

UPDATE "clients" c SET "partner_id" = p."id"
FROM "partners" p
WHERE p."company_id" = c."company_id"
  AND p."slug" = "partner_slugify"(c."name")
  AND c."partner_id" IS NULL;

-- 5b. Fournisseurs — cumulent le rôle si le tiers existe déjà
INSERT INTO "partners" ("company_id", "name", "slug", "kinds", "contact_name", "email", "phone", "address")
SELECT DISTINCT ON (s."company_id", "partner_slugify"(s."name"))
  s."company_id", s."name", "partner_slugify"(s."name"), ARRAY['FOURNISSEUR']::"PartnerKind"[],
  s."contact_name", s."email", s."phone", s."address"
FROM "suppliers" s
WHERE s."company_id" IS NOT NULL AND btrim(coalesce(s."name", '')) <> ''
ORDER BY s."company_id", "partner_slugify"(s."name"), s."id"
ON CONFLICT ("company_id", "slug")
DO UPDATE SET "kinds" = (
  SELECT ARRAY(SELECT DISTINCT unnest("partners"."kinds" || ARRAY['FOURNISSEUR']::"PartnerKind"[]))
);

UPDATE "suppliers" s SET "partner_id" = p."id"
FROM "partners" p
WHERE p."company_id" = s."company_id"
  AND p."slug" = "partner_slugify"(s."name")
  AND s."partner_id" IS NULL;

-- 5c. Prestataires — jusqu'ici du texte libre dans workshop_quotes.prestataire.
-- C'est la reprise la plus utile : elle transforme des chaînes de caractères
-- en entités mesurables.
INSERT INTO "partners" ("company_id", "name", "slug", "kinds")
SELECT DISTINCT ON (w."company_id", "partner_slugify"(w."prestataire"))
  w."company_id", btrim(w."prestataire"), "partner_slugify"(w."prestataire"),
  ARRAY['PRESTATAIRE']::"PartnerKind"[]
FROM "workshop_quotes" w
WHERE w."company_id" IS NOT NULL
  AND btrim(coalesce(w."prestataire", '')) <> ''
  AND "partner_slugify"(w."prestataire") <> ''
ORDER BY w."company_id", "partner_slugify"(w."prestataire"), w."id"
ON CONFLICT ("company_id", "slug")
DO UPDATE SET "kinds" = (
  SELECT ARRAY(SELECT DISTINCT unnest("partners"."kinds" || ARRAY['PRESTATAIRE']::"PartnerKind"[]))
);

UPDATE "workshop_quotes" w SET "partner_id" = p."id"
FROM "partners" p
WHERE p."company_id" = w."company_id"
  AND p."slug" = "partner_slugify"(w."prestataire")
  AND w."partner_id" IS NULL;

-- 5d. Métier deviné, pour préremplir la fiche
UPDATE "partners" SET "specialty" = CASE
  WHEN "name" ILIKE '%soud%'    THEN 'Soudure'
  WHEN "name" ILIKE '%peint%'   THEN 'Peinture'
  WHEN "name" ILIKE '%mecan%'   THEN 'Mécanique'
  WHEN "name" ILIKE '%electr%'  THEN 'Électricité'
  WHEN "name" ILIKE '%matelas%' THEN 'Matelasserie'
  WHEN "name" ILIKE '%frigo%'   THEN 'Climatisation'
  WHEN "name" ILIKE '%vul%'     THEN 'Pneumatique'
  WHEN "name" ILIKE '%pi_ce%'   THEN 'Pièces détachées'
  ELSE NULL END
WHERE "specialty" IS NULL AND 'PRESTATAIRE' = ANY("kinds");
