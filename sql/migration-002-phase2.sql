-- Phase 2 & 3 : Proformas, Paiements, Trésorerie
-- Exécuter après schema.sql

SET NAMES utf8mb4;

-- Proformas (estimations + échéancier)
CREATE TABLE IF NOT EXISTS proformas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  estimated_costs JSON DEFAULT NULL,
  schedule JSON DEFAULT NULL,
  pdf_path VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  INDEX idx_proformas_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Paiements (liés véhicule ou facture)
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT DEFAULT NULL,
  invoice_id INT DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'FCFA',
  payment_type VARCHAR(50) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  reference VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  INDEX idx_payments_vehicle (vehicle_id),
  INDEX idx_payments_invoice (invoice_id),
  INDEX idx_payments_paid_at (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optionnel : étendre invoices (décommenter si besoin)
-- ALTER TABLE invoices ADD COLUMN client_id INT DEFAULT NULL AFTER vehicle_id;
-- ALTER TABLE invoices ADD COLUMN invoice_number VARCHAR(100) DEFAULT NULL;
