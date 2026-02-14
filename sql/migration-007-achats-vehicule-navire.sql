-- Formulaire Nouvel achat : bloc véhicule + navire (vrac) + véhicules.couleur
-- Exécuter après migration-006. En cas d'erreur "Duplicate column/key", ignorer la ligne concernée.

SET NAMES utf8mb4;

-- ---------- Achats : bloc véhicule (VIN, marque, modèle, couleur, année, type) + navire (vrac) ----------
ALTER TABLE purchases ADD COLUMN vin VARCHAR(100) DEFAULT NULL COMMENT 'VIN du véhicule acheté';
ALTER TABLE purchases ADD COLUMN brand VARCHAR(100) DEFAULT NULL COMMENT 'Marque';
ALTER TABLE purchases ADD COLUMN model VARCHAR(100) DEFAULT NULL COMMENT 'Modèle';
ALTER TABLE purchases ADD COLUMN color VARCHAR(100) DEFAULT NULL COMMENT 'Couleur';
ALTER TABLE purchases ADD COLUMN year INT DEFAULT NULL COMMENT 'Année';
ALTER TABLE purchases ADD COLUMN vehicle_type VARCHAR(50) DEFAULT NULL COMMENT 'Berline, SUV, Pick-up, Utilitaire, Poids lourd, Occasion, Neuf, Accidenté, ou —';
ALTER TABLE purchases ADD COLUMN vessel VARCHAR(255) DEFAULT NULL COMMENT 'Navire (obligatoire si type VRAC)';
CREATE INDEX idx_purchases_vin ON purchases(vin);

-- ---------- Véhicules : couleur ----------
ALTER TABLE vehicles ADD COLUMN color VARCHAR(100) DEFAULT NULL COMMENT 'Couleur';
