-- ERP Automobile & Logistique — Schéma BDD (VIN 360°)
-- Exécuter dans la base erp_automobile (MySQL 5.7+ / 8+)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------
-- Utilisateurs & Auth
-- --------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(255) DEFAULT NULL,
  last_name VARCHAR(255) DEFAULT NULL,
  role ENUM('SUPER_ADMIN','ADMIN','COMPTABLE','AGENT_TRANSIT','COMMERCIAL','CLIENT') NOT NULL DEFAULT 'ADMIN',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(512) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_token (token(255)),
  INDEX idx_user_expires (user_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------
-- Clients (CRM)
-- --------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(100) DEFAULT NULL,
  address TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------
-- Véhicules (Parc — clé VIN)
-- --------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vin VARCHAR(100) NOT NULL UNIQUE,
  chassis_number VARCHAR(100) DEFAULT NULL,
  brand VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  year INT NOT NULL,
  vehicle_type VARCHAR(100) DEFAULT NULL,
  status ENUM('ACHETE','EN_TRANSIT','ARRIVE_PORT','EN_DOUANE','DEDOUANE','LIVRE','VENDU') NOT NULL DEFAULT 'ACHETE',
  client_id INT DEFAULT NULL,
  purchase_price DECIMAL(15,2) DEFAULT NULL,
  sale_price DECIMAL(15,2) DEFAULT NULL,
  currency VARCHAR(10) DEFAULT 'FCFA',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  INDEX idx_vehicles_status (status),
  INDEX idx_vehicles_client_id (client_id),
  INDEX idx_vehicles_created_at (created_at),
  INDEX idx_vehicles_vin (vin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------
-- Étapes de transit (par véhicule)
-- --------------------------------------
CREATE TABLE IF NOT EXISTS transit_steps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  step_name VARCHAR(100) NOT NULL,
  step_order INT DEFAULT 0,
  bl_reference VARCHAR(255) DEFAULT NULL,
  port_loading VARCHAR(255) DEFAULT NULL,
  port_unloading VARCHAR(255) DEFAULT NULL,
  date_arrival DATETIME DEFAULT NULL,
  vessel VARCHAR(255) DEFAULT NULL,
  consignee VARCHAR(255) DEFAULT NULL,
  shipper VARCHAR(255) DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  INDEX idx_transit_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------
-- Documents liés au VIN
-- --------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  type ENUM('BL','FACTURE_ACHAT','QUITTANCE','FACTURE_MECEF','PROFORMA','PHOTO','AUTRE') NOT NULL,
  file_storage_path VARCHAR(500) DEFAULT NULL,
  ocr_payload JSON DEFAULT NULL,
  generated_from_template TINYINT(1) DEFAULT 0,
  operation_id INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  INDEX idx_documents_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------
-- Charges par véhicule (compta)
-- --------------------------------------
CREATE TABLE IF NOT EXISTS charges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'FCFA',
  charge_type VARCHAR(50) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  INDEX idx_charges_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------
-- Factures MECeF (DGI Bénin)
-- --------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  mecef_code VARCHAR(100) DEFAULT NULL,
  qr_code_path VARCHAR(500) DEFAULT NULL,
  pdf_path VARCHAR(500) DEFAULT NULL,
  amount DECIMAL(15,2) DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  INDEX idx_invoices_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------
-- Historique véhicule (timeline VIN 360°)
-- --------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  action VARCHAR(100) NOT NULL,
  details JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  INDEX idx_history_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
