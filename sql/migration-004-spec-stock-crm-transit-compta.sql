-- Spec fonctionnelle : Stock, CRM, Transit, Compta
-- Exécuter après migration-003. En cas d'erreur "Duplicate column/key", ignorer la ligne.

SET NAMES utf8mb4;

-- ---------- Véhicules : stock (dates port/parc, BL, nature, régularisé) ----------
ALTER TABLE vehicles ADD COLUMN date_entree_port DATETIME DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN date_entree_parc DATETIME DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN numero_bl VARCHAR(255) DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN nature_stock VARCHAR(20) DEFAULT NULL COMMENT 'DEPOT | TRANSIT | AUTRES';
ALTER TABLE vehicles ADD COLUMN regularise TINYINT(1) DEFAULT 0 COMMENT '0=non 1=oui selon compta';
CREATE INDEX idx_vehicles_regularise ON vehicles(regularise);
CREATE INDEX idx_vehicles_nature_stock ON vehicles(nature_stock);

-- ---------- Infos société (logo, PDF) ----------
CREATE TABLE IF NOT EXISTS company_info (
  id INT AUTO_INCREMENT PRIMARY KEY,
  logo_path VARCHAR(500) DEFAULT NULL,
  raison_sociale VARCHAR(255) DEFAULT NULL,
  adresse TEXT DEFAULT NULL,
  ifu VARCHAR(100) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  site_web VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO company_info (id, raison_sociale) VALUES (1, 'Ma Société') ON DUPLICATE KEY UPDATE id=id;

-- ---------- Reçus prestataires externes ----------
CREATE TABLE IF NOT EXISTS receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prestataire_name VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'FCFA',
  document_path VARCHAR(500) DEFAULT NULL,
  operation_reference VARCHAR(255) DEFAULT NULL,
  vehicle_id INT DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  received_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  INDEX idx_receipts_vehicle (vehicle_id),
  INDEX idx_receipts_received_at (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Factures : type (temporaire / complète) ----------
ALTER TABLE invoices ADD COLUMN type_facture VARCHAR(20) DEFAULT 'COMPLETE' COMMENT 'TEMPORAIRE | COMPLETE';

-- ---------- Notes / infos additionnelles rapports compta ----------
CREATE TABLE IF NOT EXISTS report_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_type VARCHAR(50) DEFAULT 'compta',
  content TEXT DEFAULT NULL,
  extra_data JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Opérations transit & douane (catégorisées) ----------
CREATE TABLE IF NOT EXISTS transit_operations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT DEFAULT NULL,
  client_id INT DEFAULT NULL,
  operation_type VARCHAR(50) NOT NULL COMMENT 'MARITIME | VEHICULE | DEDOUANEMENT | ACHAT | IMPORT | EXPORT',
  reference VARCHAR(255) DEFAULT NULL,
  lieu_expedition VARCHAR(255) DEFAULT NULL,
  port_loading VARCHAR(255) DEFAULT NULL,
  port_unloading VARCHAR(255) DEFAULT NULL,
  date_embarquement DATETIME DEFAULT NULL,
  date_arrivee_port DATETIME DEFAULT NULL,
  vessel_name VARCHAR(255) DEFAULT NULL,
  vessel_flag VARCHAR(100) DEFAULT NULL,
  container_number VARCHAR(255) DEFAULT NULL,
  bl_number VARCHAR(255) DEFAULT NULL,
  declarant_name VARCHAR(255) DEFAULT NULL,
  customs_reference VARCHAR(255) DEFAULT NULL,
  details JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  INDEX idx_transit_ops_vehicle (vehicle_id),
  INDEX idx_transit_ops_client (client_id),
  INDEX idx_transit_ops_type (operation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
