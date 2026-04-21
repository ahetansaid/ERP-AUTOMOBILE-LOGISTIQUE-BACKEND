-- À exécuter si vous avez l'erreur "la table receipts n'a pas la colonne workshop_quote_id"
-- Dans PowerShell : Get-Content "scripts\fix_receipts_workshop_quote.sql" -Raw | C:\xampp\mysql\bin\mysql.exe -u root -p parcauto

USE parcauto;

ALTER TABLE receipts ADD COLUMN workshop_quote_id INT UNSIGNED DEFAULT NULL AFTER invoice_id;
ALTER TABLE receipts ADD KEY idx_receipts_workshop_quote (workshop_quote_id);
