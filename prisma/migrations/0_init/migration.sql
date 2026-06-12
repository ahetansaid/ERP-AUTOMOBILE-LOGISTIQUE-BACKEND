-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('DISPONIBLE', 'EN_VENTE', 'VENDU', 'EN_MAINTENANCE', 'EN_TRANSIT', 'LIVRE', 'RESERVE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('EN_COURS', 'ARRIVE', 'ANNULE');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('VRAC', 'CONTENEUR');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('EMISE', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'ANNULEE', 'EN_RETARD');

-- CreateEnum
CREATE TYPE "WorkshopQuoteStatus" AS ENUM ('EN_ATTENTE', 'APPROUVE', 'REFUSE', 'EN_COURS', 'CLOTURE', 'TERMINE');

-- CreateEnum
CREATE TYPE "ProformaStatus" AS ENUM ('BROUILLON', 'ENVOYEE', 'ACCEPTEE', 'REFUSEE', 'EXPIREE', 'CONVERTIE');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIF', 'INACTIF', 'PROSPECT', 'BLACKLISTE');

-- CreateEnum
CREATE TYPE "TreasuryTxType" AS ENUM ('ENCAISSEMENT', 'DECAISSEMENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'WARNING', 'ERROR', 'SUCCESS', 'PAYMENT_DUE', 'TRANSIT_DELAY', 'MAINTENANCE_DUE', 'QUOTE_EXPIRING');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'SALES', 'ACCOUNTING', 'WORKSHOP', 'LOGISTICS', 'USER', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_RESET', 'PERMISSION_CHANGE', 'EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('VEHICLE_PHOTO', 'PURCHASE_DOCUMENT', 'INVOICE_PDF', 'RECEIPT_PDF', 'QUOTE_PDF', 'PROFORMA_PDF', 'TRANSIT_DOCUMENT', 'COMPANY_LOGO', 'USER_AVATAR', 'OTHER');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BOUNCED', 'OPENED', 'CLICKED');

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "logo_url" VARCHAR(500),
    "primary_color" VARCHAR(20),
    "secondary_color" VARCHAR(20),
    "invoice_template" VARCHAR(50),
    "legal_number" VARCHAR(100),
    "country" VARCHAR(100),
    "default_currency" VARCHAR(10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "company_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "two_fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_fa_secret" VARCHAR(255),
    "last_login_at" TIMESTAMP(3),
    "avatar_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" INTEGER,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "refresh_token" VARCHAR(512) NOT NULL,
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "company_id" INTEGER,
    "user_id" INTEGER,
    "action" "AuditAction" NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resource_id" INTEGER,
    "before" JSONB,
    "after" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "contact_name" VARCHAR(255),
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "address" TEXT,
    "city" VARCHAR(100),
    "country" VARCHAR(100),
    "notes" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIF',
    "contact_name" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "vin" VARCHAR(50),
    "brand" VARCHAR(100),
    "model" VARCHAR(100),
    "year" INTEGER,
    "color" VARCHAR(50),
    "status" "VehicleStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "purchase_price" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "purchase_price_fcfa" DECIMAL(15,2),
    "transport_fees" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "price_sale" DECIMAL(15,2),
    "client_id" INTEGER,
    "mileage" INTEGER,
    "registration" VARCHAR(50),
    "country_origin" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "supplier_name" VARCHAR(255),
    "purchase_date" DATE,
    "container_reference" VARCHAR(100),
    "vessel" VARCHAR(255),
    "purchase_type" "PurchaseType" NOT NULL DEFAULT 'VRAC',
    "currency" VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    "status" "PurchaseStatus" NOT NULL DEFAULT 'EN_COURS',
    "arrival_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_vehicles" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "vehicle_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "vehicle_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "due_date" DATE,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'EMISE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "invoice_id" INTEGER,
    "workshop_quote_id" INTEGER,
    "amount" DECIMAL(15,2) NOT NULL,
    "payment_method" VARCHAR(50),
    "payment_date" DATE NOT NULL,
    "reference" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "label" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100),
    "amount" DECIMAL(15,2) NOT NULL,
    "charge_date" DATE NOT NULL,
    "deletion_reason" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_quotes" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "vehicle_id" INTEGER NOT NULL,
    "prestataire" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    "description" TEXT,
    "valid_until" DATE,
    "status" "WorkshopQuoteStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "workshop_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proformas" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "vehicle_id" INTEGER,
    "client_id" INTEGER,
    "total_amount" DECIMAL(15,2),
    "proforma_number" VARCHAR(50),
    "status" "ProformaStatus" DEFAULT 'BROUILLON',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "proformas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_steps" (
    "id" SERIAL NOT NULL,
    "vehicle_id" INTEGER,
    "step_name" VARCHAR(50) NOT NULL,
    "date_arrival" DATE,
    "date_departure" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "transit_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions_tresorerie" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "type" "TreasuryTxType" NOT NULL,
    "categorie" VARCHAR(80) NOT NULL,
    "reference" VARCHAR(100),
    "montant" DECIMAL(15,2) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "vehicle_id" INTEGER,
    "description" TEXT,
    "receipt_id" INTEGER,
    "purchase_id" INTEGER,
    "workshop_quote_id" INTEGER,
    "charge_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_tresorerie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "currency" VARCHAR(10) NOT NULL,
    "rate_fcfa" DECIMAL(15,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "name" VARCHAR(255),
    "type" VARCHAR(50),
    "period_start" DATE,
    "period_end" DATE,
    "file_path" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "company_id" INTEGER,
    "type" "NotificationType" NOT NULL DEFAULT 'INFO',
    "title" VARCHAR(255),
    "message" TEXT,
    "link" VARCHAR(500),
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" BIGSERIAL NOT NULL,
    "company_id" INTEGER,
    "to_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "template" VARCHAR(100),
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "provider_id" VARCHAR(255),
    "error_msg" TEXT,
    "resource" VARCHAR(100),
    "resource_id" INTEGER,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "uploaded_by" INTEGER,
    "kind" "UploadKind" NOT NULL,
    "resource" VARCHAR(100),
    "resource_id" INTEGER,
    "file_name" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "public_url" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_company" ON "users"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_permissions_code" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "idx_permissions_module" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "uk_sessions_refresh" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "idx_sessions_user" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_sessions_expires" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uk_prt_token" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_prt_user" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_audit_company" ON "audit_logs"("company_id");

-- CreateIndex
CREATE INDEX "idx_audit_user" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "idx_audit_resource" ON "audit_logs"("resource", "resource_id");

-- CreateIndex
CREATE INDEX "idx_audit_created" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "idx_suppliers_company" ON "suppliers"("company_id");

-- CreateIndex
CREATE INDEX "idx_clients_company" ON "clients"("company_id");

-- CreateIndex
CREATE INDEX "idx_vehicles_company" ON "vehicles"("company_id");

-- CreateIndex
CREATE INDEX "idx_vehicles_status" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "idx_vehicles_vin" ON "vehicles"("vin");

-- CreateIndex
CREATE INDEX "idx_vehicles_client" ON "vehicles"("client_id");

-- CreateIndex
CREATE INDEX "idx_purchases_company" ON "purchases"("company_id");

-- CreateIndex
CREATE INDEX "idx_purchases_status" ON "purchases"("status");

-- CreateIndex
CREATE INDEX "idx_pv_vehicle" ON "purchase_vehicles"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_pv" ON "purchase_vehicles"("purchase_id", "vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_invoices_vehicle" ON "invoices"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_invoices_company" ON "invoices"("company_id");

-- CreateIndex
CREATE INDEX "idx_invoices_vehicle" ON "invoices"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_invoices_client" ON "invoices"("client_id");

-- CreateIndex
CREATE INDEX "idx_receipts_company" ON "receipts"("company_id");

-- CreateIndex
CREATE INDEX "idx_receipts_invoice" ON "receipts"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_receipts_workshop_quote" ON "receipts"("workshop_quote_id");

-- CreateIndex
CREATE INDEX "idx_charges_company" ON "charges"("company_id");

-- CreateIndex
CREATE INDEX "idx_charges_date" ON "charges"("charge_date");

-- CreateIndex
CREATE INDEX "idx_wq_company" ON "workshop_quotes"("company_id");

-- CreateIndex
CREATE INDEX "idx_wq_vehicle" ON "workshop_quotes"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_wq_status" ON "workshop_quotes"("status");

-- CreateIndex
CREATE INDEX "idx_proformas_company" ON "proformas"("company_id");

-- CreateIndex
CREATE INDEX "idx_proformas_vehicle" ON "proformas"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_proformas_client" ON "proformas"("client_id");

-- CreateIndex
CREATE INDEX "idx_transit_vehicle" ON "transit_steps"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_transit_step" ON "transit_steps"("step_name");

-- CreateIndex
CREATE INDEX "idx_tt_company" ON "transactions_tresorerie"("company_id");

-- CreateIndex
CREATE INDEX "idx_tt_type" ON "transactions_tresorerie"("type");

-- CreateIndex
CREATE INDEX "idx_tt_date" ON "transactions_tresorerie"("transaction_date");

-- CreateIndex
CREATE INDEX "idx_tt_vehicle" ON "transactions_tresorerie"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_tt_receipt" ON "transactions_tresorerie"("receipt_id");

-- CreateIndex
CREATE INDEX "idx_tt_purchase" ON "transactions_tresorerie"("purchase_id");

-- CreateIndex
CREATE INDEX "idx_tt_charge" ON "transactions_tresorerie"("charge_id");

-- CreateIndex
CREATE INDEX "idx_er_company" ON "exchange_rates"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_er_company_currency" ON "exchange_rates"("company_id", "currency");

-- CreateIndex
CREATE INDEX "idx_gr_company" ON "generated_reports"("company_id");

-- CreateIndex
CREATE INDEX "idx_gr_created" ON "generated_reports"("created_at");

-- CreateIndex
CREATE INDEX "idx_notif_user" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "idx_notif_company" ON "notifications"("company_id");

-- CreateIndex
CREATE INDEX "idx_notif_read" ON "notifications"("read");

-- CreateIndex
CREATE INDEX "idx_email_company" ON "email_events"("company_id");

-- CreateIndex
CREATE INDEX "idx_email_status" ON "email_events"("status");

-- CreateIndex
CREATE INDEX "idx_email_resource" ON "email_events"("resource", "resource_id");

-- CreateIndex
CREATE INDEX "idx_uploads_company" ON "uploads"("company_id");

-- CreateIndex
CREATE INDEX "idx_uploads_user" ON "uploads"("uploaded_by");

-- CreateIndex
CREATE INDEX "idx_uploads_resource" ON "uploads"("resource", "resource_id");

-- CreateIndex
CREATE INDEX "idx_uploads_kind" ON "uploads"("kind");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_vehicles" ADD CONSTRAINT "purchase_vehicles_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_vehicles" ADD CONSTRAINT "purchase_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_workshop_quote_id_fkey" FOREIGN KEY ("workshop_quote_id") REFERENCES "workshop_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_quotes" ADD CONSTRAINT "workshop_quotes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_quotes" ADD CONSTRAINT "workshop_quotes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_steps" ADD CONSTRAINT "transit_steps_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions_tresorerie" ADD CONSTRAINT "transactions_tresorerie_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions_tresorerie" ADD CONSTRAINT "transactions_tresorerie_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions_tresorerie" ADD CONSTRAINT "transactions_tresorerie_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions_tresorerie" ADD CONSTRAINT "transactions_tresorerie_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions_tresorerie" ADD CONSTRAINT "transactions_tresorerie_workshop_quote_id_fkey" FOREIGN KEY ("workshop_quote_id") REFERENCES "workshop_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions_tresorerie" ADD CONSTRAINT "transactions_tresorerie_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

