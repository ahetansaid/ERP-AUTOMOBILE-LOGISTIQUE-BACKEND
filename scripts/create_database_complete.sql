-- ParcAuto Manager - Creation complete de la base (MySQL 5.7+)
-- Usage : mysql -u root -p < scripts/create_database_complete.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS parcauto CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE parcauto;

-- ---------------------------------------------------------------------------
-- Companies (multi-tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  address TEXT DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) DEFAULT NULL,
  last_name VARCHAR(100) DEFAULT NULL,
  role VARCHAR(50) DEFAULT 'USER',
  company_id INT UNSIGNED DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_company (company_id),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  address TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_suppliers_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  address TEXT DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  country VARCHAR(100) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  status VARCHAR(50) DEFAULT 'ACTIF',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_clients_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  vin VARCHAR(50) DEFAULT NULL,
  brand VARCHAR(100) DEFAULT NULL,
  model VARCHAR(100) DEFAULT NULL,
  year SMALLINT UNSIGNED DEFAULT NULL,
  color VARCHAR(50) DEFAULT NULL,
  status VARCHAR(50) DEFAULT 'DISPONIBLE',
  purchase_price DECIMAL(15,2) DEFAULT 0,
  purchase_price_fcfa DECIMAL(15,2) DEFAULT NULL,
  transport_fees DECIMAL(15,2) DEFAULT 0,
  price_sale DECIMAL(15,2) DEFAULT NULL,
  client_id INT UNSIGNED DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_vehicles_company (company_id),
  KEY idx_vehicles_status (status),
  KEY idx_vehicles_vin (vin),
  KEY idx_vehicles_client (client_id),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED NOT NULL,
  supplier_name VARCHAR(255) DEFAULT NULL,
  purchase_date DATE DEFAULT NULL,
  container_reference VARCHAR(100) DEFAULT NULL,
  vessel VARCHAR(255) DEFAULT NULL,
  purchase_type VARCHAR(50) DEFAULT 'VRAC',
  currency VARCHAR(10) DEFAULT 'FCFA',
  status VARCHAR(50) DEFAULT 'EN_COURS',
  arrival_date DATE DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_purchases_company (company_id),
  KEY idx_purchases_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Purchase-Vehicles (liaison achat / vehicules)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_vehicles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  purchase_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pv (purchase_id, vehicle_id),
  KEY idx_pv_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  client_id INT UNSIGNED NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  due_date DATE DEFAULT NULL,
  invoice_number VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'EMISE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_invoices_company (company_id),
  KEY idx_invoices_vehicle (vehicle_id),
  KEY idx_invoices_client (client_id),
  UNIQUE KEY uk_invoices_vehicle (vehicle_id),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Receipts (facture ou devis atelier)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  invoice_id INT UNSIGNED DEFAULT NULL,
  workshop_quote_id INT UNSIGNED DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT NULL,
  payment_date DATE NOT NULL,
  reference VARCHAR(100) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_receipts_company (company_id),
  KEY idx_receipts_invoice (invoice_id),
  KEY idx_receipts_workshop_quote (workshop_quote_id),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Charges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charges (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  label VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL,
  charge_date DATE NOT NULL,
  deletion_reason TEXT DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_charges_company (company_id),
  KEY idx_charges_date (charge_date),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Workshop quotes (devis atelier)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshop_quotes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  prestataire VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'FCFA',
  description TEXT DEFAULT NULL,
  valid_until DATE DEFAULT NULL,
  status VARCHAR(50) DEFAULT 'EN_ATTENTE',
  closed_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_wq_company (company_id),
  KEY idx_wq_vehicle (vehicle_id),
  KEY idx_wq_status (status),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Proformas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proformas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  vehicle_id INT UNSIGNED DEFAULT NULL,
  client_id INT UNSIGNED DEFAULT NULL,
  total_amount DECIMAL(15,2) DEFAULT NULL,
  proforma_number VARCHAR(50) DEFAULT NULL,
  status VARCHAR(50) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_proformas_company (company_id),
  KEY idx_proformas_vehicle (vehicle_id),
  KEY idx_proformas_client (client_id),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Transit steps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transit_steps (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id INT UNSIGNED DEFAULT NULL,
  step_name VARCHAR(50) NOT NULL,
  date_arrival DATE DEFAULT NULL,
  date_departure DATE DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_transit_vehicle (vehicle_id),
  KEY idx_transit_step (step_name),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Exchange rates (GET/PUT /settings/rates)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  currency VARCHAR(10) NOT NULL,
  rate_fcfa DECIMAL(15,4) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_er_company_currency (company_id, currency),
  KEY idx_er_company (company_id),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Generated reports (GET /reports)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_reports (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  name VARCHAR(255) DEFAULT NULL,
  type VARCHAR(50) DEFAULT NULL,
  period_start DATE DEFAULT NULL,
  period_end DATE DEFAULT NULL,
  file_path VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gr_company (company_id),
  KEY idx_gr_created (created_at),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Notifications (GET /notifications)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED DEFAULT NULL,
  company_id INT UNSIGNED DEFAULT NULL,
  type VARCHAR(50) DEFAULT NULL,
  title VARCHAR(255) DEFAULT NULL,
  message TEXT DEFAULT NULL,
  `read` TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_user (user_id),
  KEY idx_notif_company (company_id),
  KEY idx_notif_read (`read`),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Transactions trésorerie (encaissements / décaissements automatiques)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions_tresorerie (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id INT UNSIGNED DEFAULT NULL,
  type VARCHAR(20) NOT NULL COMMENT 'ENCAISSEMENT | DECAISSEMENT',
  categorie VARCHAR(80) NOT NULL COMMENT 'Paiement facture | Achat véhicule | Transport | Réparation | etc.',
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

-- ---------------------------------------------------------------------------
-- Donnees initiales (taux FCFA par defaut)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO exchange_rates (company_id, currency, rate_fcfa, is_active)
SELECT NULL, 'USD', 600, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM exchange_rates WHERE currency = 'USD' AND company_id IS NULL LIMIT 1);
INSERT IGNORE INTO exchange_rates (company_id, currency, rate_fcfa, is_active)
SELECT NULL, 'EUR', 655, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM exchange_rates WHERE currency = 'EUR' AND company_id IS NULL LIMIT 1);

SET FOREIGN_KEY_CHECKS = 1;

-- Fin du script. Pour creer un admin :
-- node -e "require('bcrypt').hash('VotreMotDePasse',12).then(h=>console.log(h))"
-- INSERT INTO users (email, password, first_name, last_name, role, is_active)
-- VALUES ('admin@parcauto.local', '<HASH>', 'Admin', 'ParcAuto', 'ADMIN', 1);
