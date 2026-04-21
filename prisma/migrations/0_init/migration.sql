-- CreateTable
CREATE TABLE `companies` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `address` TEXT NULL,
    `phone` VARCHAR(50) NULL,
    `email` VARCHAR(255) NULL,
    `logo_url` VARCHAR(500) NULL,
    `primary_color` VARCHAR(20) NULL,
    `secondary_color` VARCHAR(20) NULL,
    `invoice_template` VARCHAR(50) NULL,
    `legal_number` VARCHAR(100) NULL,
    `country` VARCHAR(100) NULL,
    `default_currency` VARCHAR(10) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `first_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `role` ENUM('ADMIN', 'MANAGER', 'SALES', 'ACCOUNTING', 'WORKSHOP', 'LOGISTICS', 'USER', 'READ_ONLY') NOT NULL DEFAULT 'USER',
    `company_id` INTEGER UNSIGNED NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `two_fa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `two_fa_secret` VARCHAR(255) NULL,
    `last_login_at` DATETIME(0) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_users_email`(`email`),
    INDEX `idx_users_company`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(100) NOT NULL,
    `module` VARCHAR(50) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `description` VARCHAR(255) NULL,

    UNIQUE INDEX `uk_permissions_code`(`code`),
    INDEX `idx_permissions_module`(`module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `user_id` INTEGER UNSIGNED NOT NULL,
    `permission_id` INTEGER UNSIGNED NOT NULL,
    `granted_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `granted_by` INTEGER UNSIGNED NULL,

    PRIMARY KEY (`user_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `refresh_token` VARCHAR(512) NOT NULL,
    `user_agent` VARCHAR(500) NULL,
    `ip_address` VARCHAR(45) NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `revoked_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_sessions_refresh`(`refresh_token`),
    INDEX `idx_sessions_user`(`user_id`),
    INDEX `idx_sessions_expires`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `token` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `used_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_prt_token`(`token`),
    INDEX `idx_prt_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `user_id` INTEGER UNSIGNED NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_RESET', 'PERMISSION_CHANGE', 'EXPORT', 'IMPORT') NOT NULL,
    `resource` VARCHAR(100) NOT NULL,
    `resource_id` INTEGER UNSIGNED NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_audit_company`(`company_id`),
    INDEX `idx_audit_user`(`user_id`),
    INDEX `idx_audit_resource`(`resource`, `resource_id`),
    INDEX `idx_audit_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `name` VARCHAR(255) NOT NULL,
    `contact_name` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(50) NULL,
    `address` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_suppliers_company`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clients` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(50) NULL,
    `address` TEXT NULL,
    `city` VARCHAR(100) NULL,
    `country` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `status` ENUM('ACTIF', 'INACTIF', 'PROSPECT', 'BLACKLISTE') NOT NULL DEFAULT 'ACTIF',
    `contact_name` VARCHAR(255) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_clients_company`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `vin` VARCHAR(50) NULL,
    `brand` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `year` SMALLINT UNSIGNED NULL,
    `color` VARCHAR(50) NULL,
    `status` ENUM('DISPONIBLE', 'EN_VENTE', 'VENDU', 'EN_MAINTENANCE', 'EN_TRANSIT', 'LIVRE', 'RESERVE') NOT NULL DEFAULT 'DISPONIBLE',
    `purchase_price` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `purchase_price_fcfa` DECIMAL(15, 2) NULL,
    `transport_fees` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `price_sale` DECIMAL(15, 2) NULL,
    `client_id` INTEGER UNSIGNED NULL,
    `mileage` INTEGER UNSIGNED NULL,
    `registration` VARCHAR(50) NULL,
    `country_origin` VARCHAR(100) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_vehicles_company`(`company_id`),
    INDEX `idx_vehicles_status`(`status`),
    INDEX `idx_vehicles_vin`(`vin`),
    INDEX `idx_vehicles_client`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchases` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NOT NULL,
    `supplier_name` VARCHAR(255) NULL,
    `purchase_date` DATE NULL,
    `container_reference` VARCHAR(100) NULL,
    `vessel` VARCHAR(255) NULL,
    `purchase_type` ENUM('VRAC', 'CONTENEUR') NOT NULL DEFAULT 'VRAC',
    `currency` VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    `status` ENUM('EN_COURS', 'ARRIVE', 'ANNULE') NOT NULL DEFAULT 'EN_COURS',
    `arrival_date` DATE NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_purchases_company`(`company_id`),
    INDEX `idx_purchases_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_vehicles` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `purchase_id` INTEGER UNSIGNED NOT NULL,
    `vehicle_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_pv_vehicle`(`vehicle_id`),
    UNIQUE INDEX `uk_pv`(`purchase_id`, `vehicle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `vehicle_id` INTEGER UNSIGNED NOT NULL,
    `client_id` INTEGER UNSIGNED NOT NULL,
    `total_amount` DECIMAL(15, 2) NOT NULL,
    `invoice_number` VARCHAR(50) NOT NULL,
    `due_date` DATE NULL,
    `status` ENUM('EMISE', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'ANNULEE', 'EN_RETARD') NOT NULL DEFAULT 'EMISE',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_invoices_vehicle`(`vehicle_id`),
    INDEX `idx_invoices_company`(`company_id`),
    INDEX `idx_invoices_vehicle`(`vehicle_id`),
    INDEX `idx_invoices_client`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipts` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `invoice_id` INTEGER UNSIGNED NULL,
    `workshop_quote_id` INTEGER UNSIGNED NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `payment_method` VARCHAR(50) NULL,
    `payment_date` DATE NOT NULL,
    `reference` VARCHAR(100) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_receipts_company`(`company_id`),
    INDEX `idx_receipts_invoice`(`invoice_id`),
    INDEX `idx_receipts_workshop_quote`(`workshop_quote_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `charges` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `label` VARCHAR(255) NOT NULL,
    `category` VARCHAR(100) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `charge_date` DATE NOT NULL,
    `deletion_reason` TEXT NULL,
    `deleted_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_charges_company`(`company_id`),
    INDEX `idx_charges_date`(`charge_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workshop_quotes` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `vehicle_id` INTEGER UNSIGNED NOT NULL,
    `prestataire` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    `description` TEXT NULL,
    `valid_until` DATE NULL,
    `status` ENUM('EN_ATTENTE', 'APPROUVE', 'REFUSE', 'EN_COURS', 'CLOTURE') NOT NULL DEFAULT 'EN_ATTENTE',
    `closed_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_wq_company`(`company_id`),
    INDEX `idx_wq_vehicle`(`vehicle_id`),
    INDEX `idx_wq_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proformas` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `vehicle_id` INTEGER UNSIGNED NULL,
    `client_id` INTEGER UNSIGNED NULL,
    `total_amount` DECIMAL(15, 2) NULL,
    `proforma_number` VARCHAR(50) NULL,
    `status` ENUM('BROUILLON', 'ENVOYEE', 'ACCEPTEE', 'REFUSEE', 'EXPIREE', 'CONVERTIE') NULL DEFAULT 'BROUILLON',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_proformas_company`(`company_id`),
    INDEX `idx_proformas_vehicle`(`vehicle_id`),
    INDEX `idx_proformas_client`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transit_steps` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `vehicle_id` INTEGER UNSIGNED NULL,
    `step_name` ENUM('DEVIS', 'RESERVE', 'EMBARQUE', 'EN_TRANSIT', 'DEDOUANEMENT', 'LIVRE', 'ARCHIVE') NOT NULL,
    `date_arrival` DATE NULL,
    `date_departure` DATE NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_transit_vehicle`(`vehicle_id`),
    INDEX `idx_transit_step`(`step_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions_tresorerie` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `type` ENUM('ENCAISSEMENT', 'DECAISSEMENT') NOT NULL,
    `categorie` VARCHAR(80) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `montant` DECIMAL(15, 2) NOT NULL,
    `transaction_date` DATE NOT NULL,
    `vehicle_id` INTEGER UNSIGNED NULL,
    `description` TEXT NULL,
    `receipt_id` INTEGER UNSIGNED NULL,
    `purchase_id` INTEGER UNSIGNED NULL,
    `workshop_quote_id` INTEGER UNSIGNED NULL,
    `charge_id` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_tt_company`(`company_id`),
    INDEX `idx_tt_type`(`type`),
    INDEX `idx_tt_date`(`transaction_date`),
    INDEX `idx_tt_vehicle`(`vehicle_id`),
    INDEX `idx_tt_receipt`(`receipt_id`),
    INDEX `idx_tt_purchase`(`purchase_id`),
    INDEX `idx_tt_charge`(`charge_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exchange_rates` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `currency` VARCHAR(10) NOT NULL,
    `rate_fcfa` DECIMAL(15, 4) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    INDEX `idx_er_company`(`company_id`),
    UNIQUE INDEX `uk_er_company_currency`(`company_id`, `currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generated_reports` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `name` VARCHAR(255) NULL,
    `type` VARCHAR(50) NULL,
    `period_start` DATE NULL,
    `period_end` DATE NULL,
    `file_path` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_gr_company`(`company_id`),
    INDEX `idx_gr_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NULL,
    `company_id` INTEGER UNSIGNED NULL,
    `type` ENUM('INFO', 'WARNING', 'ERROR', 'SUCCESS', 'PAYMENT_DUE', 'TRANSIT_DELAY', 'MAINTENANCE_DUE', 'QUOTE_EXPIRING') NOT NULL DEFAULT 'INFO',
    `title` VARCHAR(255) NULL,
    `message` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_notif_user`(`user_id`),
    INDEX `idx_notif_company`(`company_id`),
    INDEX `idx_notif_read`(`read`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `to_email` VARCHAR(255) NOT NULL,
    `subject` VARCHAR(500) NOT NULL,
    `template` VARCHAR(100) NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'BOUNCED', 'OPENED', 'CLICKED') NOT NULL DEFAULT 'PENDING',
    `provider_id` VARCHAR(255) NULL,
    `error_msg` TEXT NULL,
    `resource` VARCHAR(100) NULL,
    `resource_id` INTEGER UNSIGNED NULL,
    `sent_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_email_company`(`company_id`),
    INDEX `idx_email_status`(`status`),
    INDEX `idx_email_resource`(`resource`, `resource_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `uploads` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER UNSIGNED NULL,
    `uploaded_by` INTEGER UNSIGNED NULL,
    `kind` ENUM('VEHICLE_PHOTO', 'PURCHASE_DOCUMENT', 'INVOICE_PDF', 'RECEIPT_PDF', 'QUOTE_PDF', 'PROFORMA_PDF', 'TRANSIT_DOCUMENT', 'COMPANY_LOGO', 'USER_AVATAR', 'OTHER') NOT NULL,
    `resource` VARCHAR(100) NULL,
    `resource_id` INTEGER UNSIGNED NULL,
    `file_name` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` BIGINT UNSIGNED NOT NULL,
    `storage_key` VARCHAR(500) NOT NULL,
    `public_url` VARCHAR(500) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_uploads_company`(`company_id`),
    INDEX `idx_uploads_user`(`uploaded_by`),
    INDEX `idx_uploads_resource`(`resource`, `resource_id`),
    INDEX `idx_uploads_kind`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clients` ADD CONSTRAINT `clients_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_vehicles` ADD CONSTRAINT `purchase_vehicles_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_vehicles` ADD CONSTRAINT `purchase_vehicles_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_workshop_quote_id_fkey` FOREIGN KEY (`workshop_quote_id`) REFERENCES `workshop_quotes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charges` ADD CONSTRAINT `charges_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workshop_quotes` ADD CONSTRAINT `workshop_quotes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workshop_quotes` ADD CONSTRAINT `workshop_quotes_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proformas` ADD CONSTRAINT `proformas_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proformas` ADD CONSTRAINT `proformas_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proformas` ADD CONSTRAINT `proformas_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transit_steps` ADD CONSTRAINT `transit_steps_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions_tresorerie` ADD CONSTRAINT `transactions_tresorerie_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions_tresorerie` ADD CONSTRAINT `transactions_tresorerie_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions_tresorerie` ADD CONSTRAINT `transactions_tresorerie_receipt_id_fkey` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions_tresorerie` ADD CONSTRAINT `transactions_tresorerie_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions_tresorerie` ADD CONSTRAINT `transactions_tresorerie_workshop_quote_id_fkey` FOREIGN KEY (`workshop_quote_id`) REFERENCES `workshop_quotes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions_tresorerie` ADD CONSTRAINT `transactions_tresorerie_charge_id_fkey` FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_rates` ADD CONSTRAINT `exchange_rates_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_reports` ADD CONSTRAINT `generated_reports_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

