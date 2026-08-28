-- Les deux portes de sortie : atelier et livraison.
--
-- POURQUOI PAS UNE ENTITÉ NOUVELLE
--
-- La sortie d'atelier et la livraison au client sont le même geste dans deux
-- sens : une enveloppe (devis ou facture), des reçus qui la vident, une porte
-- qui s'ouvre ensuite. `transit_steps` porte déjà une chronologie datée par
-- véhicule, et le dossier 360° l'affiche. Deux jalons de plus y suffisent ;
-- une entité de plus aurait été un écran de plus, tenu par personne.
--
-- CE QUE `solde_gele` PROTÈGE
--
-- Le solde restant AU MOMENT de la sortie. Sans lui, trois mois plus tard tout
-- est réglé et plus rien ne montre qu'un véhicule est parti payé à 40 %. C'est
-- la seule colonne ici qui ne peut pas être recalculée après coup — toutes les
-- autres se retrouvent, celle-là se perd.

ALTER TABLE "transit_steps" ADD COLUMN "company_id" INTEGER;
ALTER TABLE "transit_steps" ADD COLUMN "doc_ref"    VARCHAR(100);
ALTER TABLE "transit_steps" ADD COLUMN "solde_gele" DECIMAL(15,2);
ALTER TABLE "transit_steps" ADD COLUMN "motif"      VARCHAR(500);

-- Reprise : l'étape hérite de la société de son véhicule. Les étapes sans
-- véhicule restent à NULL — elles n'appartiennent à personne.
UPDATE "transit_steps" ts
   SET "company_id" = v."company_id"
  FROM "vehicles" v
 WHERE ts."vehicle_id" = v."id"
   AND ts."company_id" IS NULL;

ALTER TABLE "transit_steps"
  ADD CONSTRAINT "transit_steps_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Gagner une colonne `company_id` suffit à faire entrer le modèle dans
-- TENANT_MODELS (src/lib/prisma.js) : l'isolation devient automatique, là où
-- elle reposait jusqu'ici sur un filtre écrit à la main dans chaque requête.
CREATE INDEX "idx_transit_company" ON "transit_steps"("company_id");

-- Un véhicule ne sort qu'une fois par porte. L'index partiel l'impose en base,
-- pas seulement dans le code : une double livraison fausserait le coût de
-- revient figé et le solde gelé.
CREATE UNIQUE INDEX "uk_transit_sortie_unique"
    ON "transit_steps"("vehicle_id", "step_name")
 WHERE "step_name" IN ('SORTIE_ATELIER', 'LIVRAISON_CLIENT');
