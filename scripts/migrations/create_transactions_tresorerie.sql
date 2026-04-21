-- Table des mouvements de trésorerie (encaissements / décaissements)
-- Alimentée automatiquement à chaque paiement client, achat, réparation, charge, transport.
USE parcauto;

CREATE TABLE IF NOT EXISTS transactions_tresorerie (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  type VARCHAR(20) NOT NULL COMMENT 'ENCAISSEMENT | DECAISSEMENT',
  categorie VARCHAR(80) NOT NULL COMMENT 'Paiement facture | Achat véhicule | Transport | Réparation | Charge administrative | Carburant | Autres charges',
  reference VARCHAR(100) DEFAULT NULL,
  montant DECIMAL(15,2) NOT NULL,
  transaction_date DATE NOT NULL,
  vehicle_id INT UNSIGNED DEFAULT NULL,
  description TEXT DEFAULT NULL,
  receipt_id INT UNSIGNED DEFAULT NULL,
  purchase_id INT UNSIGNED DEFAULT NULL,
  workshop_quote_id INT UNSIGNED DEFAULT NULL,
  charge_id INT UNSIGNED DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tt_company (company_id),
  KEY idx_tt_type (type),
  KEY idx_tt_date (transaction_date),
  KEY idx_tt_vehicle (vehicle_id),
  KEY idx_tt_receipt (receipt_id),
  KEY idx_tt_purchase (purchase_id),
  KEY idx_tt_charge (charge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
