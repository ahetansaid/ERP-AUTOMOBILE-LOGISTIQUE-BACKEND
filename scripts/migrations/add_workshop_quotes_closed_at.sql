-- Date de clôture du devis atelier (quand solde restant = 0).
ALTER TABLE workshop_quotes ADD COLUMN closed_at DATETIME DEFAULT NULL AFTER status;
