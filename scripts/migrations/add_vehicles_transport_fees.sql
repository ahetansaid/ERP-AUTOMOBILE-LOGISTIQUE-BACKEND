-- Frais de transport par véhicule (décaissement trésorerie)
USE parcauto;
ALTER TABLE vehicles ADD COLUMN transport_fees DECIMAL(15,2) DEFAULT 0 AFTER purchase_price_fcfa;
