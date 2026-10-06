-- Facture normalisée e-MECeF (DGI Bénin).
--
-- CE QU'ON CONSERVE, ET POURQUOI
--
-- La plateforme ne certifie pas : elle transmet et garde la preuve. En cas de
-- contrôle, la question sera « qu'avez-vous déclaré », pas « qu'affiche votre
-- écran aujourd'hui ». On garde donc les deux sens :
--
--   mecef_payload  ce qui a été ENVOYÉ, figé au moment de l'envoi
--   mecef_code     ce que la DGI a RENVOYÉ, et qui fait foi
--
-- mecef_uid est écrit AVANT la confirmation : c'est la seule clé permettant de
-- retrouver une facture chez la DGI si la liaison se coupe entre la création
-- et la confirmation. Sans lui, on ne saurait plus si la pièce a été déclarée.

CREATE TYPE "MecefStatus" AS ENUM (
  'A_NORMALISER',
  'EN_ATTENTE',
  'NORMALISEE',
  'ANNULEE',
  'ECHEC'
);

ALTER TABLE "invoices" ADD COLUMN "mecef_status"  "MecefStatus" NOT NULL DEFAULT 'A_NORMALISER';
ALTER TABLE "invoices" ADD COLUMN "mecef_uid"     VARCHAR(100);
ALTER TABLE "invoices" ADD COLUMN "mecef_code"    VARCHAR(255);
ALTER TABLE "invoices" ADD COLUMN "mecef_qr_code" TEXT;
ALTER TABLE "invoices" ADD COLUMN "mecef_at"      TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "mecef_payload" JSONB;
ALTER TABLE "invoices" ADD COLUMN "mecef_error"   VARCHAR(1000);

-- Une facture ne se normalise qu'une fois. L'unicité est posée en base et pas
-- seulement dans le code : deux requêtes simultanées produiraient sinon deux
-- déclarations pour une seule vente.
CREATE UNIQUE INDEX "uk_invoices_mecef_uid" ON "invoices"("mecef_uid")
  WHERE "mecef_uid" IS NOT NULL;

CREATE INDEX "idx_invoices_mecef_status" ON "invoices"("company_id", "mecef_status");

-- Réglages par société : le connecteur est enfichable par pays, et chaque
-- société a son propre jeton DGI.
--
-- mecef_token est un SECRET. Il n'est jamais renvoyé par l'API (écriture
-- seule), et il est masqué dans le journal d'audit comme un mot de passe.
ALTER TABLE "companies" ADD COLUMN "mecef_token"        TEXT;
ALTER TABLE "companies" ADD COLUMN "mecef_base_url"     VARCHAR(255);
ALTER TABLE "companies" ADD COLUMN "mecef_tax_group"    VARCHAR(10);
ALTER TABLE "companies" ADD COLUMN "mecef_invoice_type" VARCHAR(10);
