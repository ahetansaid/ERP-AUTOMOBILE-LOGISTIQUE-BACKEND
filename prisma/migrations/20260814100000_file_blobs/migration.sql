-- Contenu binaire des fichiers, pour le pilote de stockage `db`.
--
-- Séparé de `uploads` à dessein : `uploads` porte les métadonnées, listées à
-- longueur de journée ; le binaire n'est lu qu'au téléchargement. Deux tables
-- évitent que chaque listing de pièces traîne des mégaoctets derrière lui.
--
-- Ce pilote convient aux pièces justificatives — quelques centaines de PDF.
-- Pour des photos de véhicules, préférer un stockage objet : les sauvegardes
-- et les branches Neon copient ce contenu à chaque fois.

CREATE TABLE "file_blobs" (
    "storage_key"  VARCHAR(500) NOT NULL,
    "company_id"   INTEGER      NOT NULL,
    "content_type" VARCHAR(150) NOT NULL,
    "size_bytes"   INTEGER      NOT NULL,
    "data"         BYTEA        NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("storage_key")
);

CREATE INDEX "idx_file_blob_company" ON "file_blobs"("company_id");

-- Le contenu est déjà compressé (PDF, JPEG) : la compression TOAST par défaut
-- ne ferait que consommer du temps processeur pour rien.
ALTER TABLE "file_blobs" ALTER COLUMN "data" SET STORAGE EXTERNAL;
