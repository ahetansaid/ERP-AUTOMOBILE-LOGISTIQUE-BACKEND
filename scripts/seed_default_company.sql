-- Societe par defaut + attribution a l'admin (pour avoir companyId dans le JWT)
USE parcauto;

INSERT INTO companies (name, address, phone, email) VALUES
  ('ParcAuto Principal', NULL, NULL, NULL);

SET @company_id = LAST_INSERT_ID();

UPDATE users SET company_id = @company_id WHERE email = 'admin@parcauto.local' AND company_id IS NULL;

SELECT CONCAT('Societe id=', @company_id, ' assignee a admin@parcauto.local') AS resultat;
