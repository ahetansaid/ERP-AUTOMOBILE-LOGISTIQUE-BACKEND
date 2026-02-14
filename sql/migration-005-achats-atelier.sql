-- Achats (Supply chain) + Atelier / Maintenance véhicules
-- Exécuter après migration-004. En cas d'erreur "Duplicate column/key", ignorer la ligne concernée.

SET NAMES utf8mb4;

-- ---------- Table Achats (purchases) ----------
CREATE TABLE IF NOT EXISTS purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_price DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  type_achat VARCHAR(20) NOT NULL COMMENT 'VRAC | CONTENEUR',
  container_reference VARCHAR(255) DEFAULT NULL COMMENT 'Référence conteneur (obligatoire en pratique)',
  conversion_rate DECIMAL(15,6) DEFAULT NULL COMMENT 'Taux vers FCFA au moment de l\'achat',
  amount_fcfa DECIMAL(15,2) DEFAULT NULL COMMENT 'Montant converti en FCFA',
  purchase_date DATETIME DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_purchases_created (created_at),
  INDEX idx_purchases_type (type_achat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Véhicules : lien achat + atelier + accidenté ----------
ALTER TABLE vehicles ADD COLUMN purchase_id INT DEFAULT NULL COMMENT 'Achat d\'origine si véhicule ajouté depuis un achat';
ALTER TABLE vehicles ADD COLUMN in_maintenance TINYINT(1) DEFAULT 0 COMMENT '0=non 1=oui (atelier)';
ALTER TABLE vehicles ADD COLUMN maintenance_prestataire VARCHAR(255) DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN maintenance_devis TEXT DEFAULT NULL COMMENT 'Référence ou montant devis';
ALTER TABLE vehicles ADD COLUMN accidente TINYINT(1) DEFAULT 0 COMMENT '0=non 1=oui';

-- Clé étrangère et index (après création de purchases)
ALTER TABLE vehicles ADD CONSTRAINT fk_vehicles_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;
CREATE INDEX idx_vehicles_purchase_id ON vehicles(purchase_id);
CREATE INDEX idx_vehicles_in_maintenance ON vehicles(in_maintenance);
