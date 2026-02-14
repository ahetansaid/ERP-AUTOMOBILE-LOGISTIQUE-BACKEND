-- Compta : factures / devis (statut, client, lignes, TVA)
-- Exécuter après migration-002-phase2.sql
-- Exécuter chaque ligne une par une ; en cas d'erreur #1060 (colonne déjà existante)
-- ou "Duplicate key" (index déjà existant), ignorer cette ligne et passer à la suivante.

SET NAMES utf8mb4;

-- Si la colonne status n'existe pas encore (sinon ignorer) :
-- ALTER TABLE invoices ADD COLUMN status VARCHAR(20) DEFAULT 'FACTURE' COMMENT 'DEVIS | FACTURE';

ALTER TABLE invoices ADD COLUMN client_id INT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tva_rate DECIMAL(5,2) DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN lines JSON DEFAULT NULL COMMENT 'Lignes: [{ label, quantity, unitPrice, amount }]';
ALTER TABLE invoices ADD COLUMN invoice_number VARCHAR(100) DEFAULT NULL;

-- Index (ignorer si erreur "Duplicate key")
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_client ON invoices(client_id);
