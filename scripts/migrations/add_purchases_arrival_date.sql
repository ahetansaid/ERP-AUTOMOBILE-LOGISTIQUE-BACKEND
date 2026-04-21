-- Date d'arrivée de l'achat (passage au statut Arrivé).
-- Exécuter sur une base existante si la colonne n'existe pas.

ALTER TABLE purchases ADD COLUMN arrival_date DATE DEFAULT NULL AFTER status;
