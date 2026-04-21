-- Ajoute la colonne purchase_price_fcfa à la table vehicles (équivalent FCFA du prix d'achat).
-- Exécuter sur une base existante si la colonne n'existe pas.

ALTER TABLE vehicles ADD COLUMN purchase_price_fcfa DECIMAL(15,2) DEFAULT NULL AFTER purchase_price;
