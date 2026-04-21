-- Reçus liés aux devis : ajouter workshop_quote_id à receipts si absent
-- Exécuter : mysql -u root -p parcauto < scripts/migrations/add_receipts_workshop_quote_id.sql

USE parcauto;

-- Vérifier si la colonne existe avant d'ajouter (évite l'erreur Duplicate column)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'parcauto' AND TABLE_NAME = 'receipts' AND COLUMN_NAME = 'workshop_quote_id'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE receipts ADD COLUMN workshop_quote_id INT UNSIGNED DEFAULT NULL AFTER invoice_id, ADD KEY idx_receipts_workshop_quote (workshop_quote_id)',
  'SELECT ''Colonne workshop_quote_id deja presente'' AS resultat'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
