-- Devis prestataires + lien reçu ↔ devis
-- Exécuter après migration-005. En cas d'erreur "Duplicate column/key", ignorer la ligne concernée.

SET NAMES utf8mb4;

-- ---------- Table Devis (prestataire : véhicule, prestataire, montant, service, date) ----------
CREATE TABLE IF NOT EXISTS devis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  prestataire_name VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'FCFA',
  service TEXT DEFAULT NULL COMMENT 'Précision du service / prestation',
  devis_date DATE DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  INDEX idx_devis_vehicle (vehicle_id),
  INDEX idx_devis_date (devis_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Reçus : lien vers un devis ----------
ALTER TABLE receipts ADD COLUMN devis_id INT DEFAULT NULL COMMENT 'Devis prestataire lié';
ALTER TABLE receipts ADD CONSTRAINT fk_receipts_devis FOREIGN KEY (devis_id) REFERENCES devis(id) ON DELETE SET NULL;
CREATE INDEX idx_receipts_devis_id ON receipts(devis_id);
