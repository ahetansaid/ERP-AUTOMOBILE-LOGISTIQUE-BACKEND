-- Règle métier : 1 véhicule = 1 facture.
-- Ajoute une contrainte UNIQUE sur invoices(vehicle_id).
-- À exécuter uniquement si aucune facture en double n'existe (sinon supprimer ou fusionner les doublons avant).

ALTER TABLE invoices ADD UNIQUE KEY uk_invoices_vehicle (vehicle_id);
