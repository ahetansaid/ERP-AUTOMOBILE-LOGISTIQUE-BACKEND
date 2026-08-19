-- Archivage d'un véhicule.
--
-- Décision de VISIBILITÉ, jamais de comptabilité. Un véhicule archivé sort des
-- listes ; ses écritures restent au grand livre et continuent de compter.
--
-- Faire autrement offrirait un moyen discret de modifier les comptes en
-- changeant un drapeau — exactement ce que le grand livre en écriture seule
-- s'emploie à empêcher. Pour qu'un coût cesse de compter, il faut le
-- contre-passer, et cela laisse une trace.

ALTER TABLE "vehicles" ADD COLUMN "archived_at"    TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "archive_reason" VARCHAR(500);

-- Les listes filtrent sur ce champ à chaque requête.
CREATE INDEX "idx_vehicles_archived" ON "vehicles"("company_id", "archived_at");
