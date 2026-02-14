# ERP Automobile & Logistique — Backend

API Node.js + Express + MySQL (VIN 360°, conforme au rapport API frontend).

## Prérequis

- Node.js 18+
- MySQL (ex. XAMPP) : créer la base **erp_automobile** dans phpMyAdmin

## Installation

```bash
cd ERP-AUTOMOBILE-LOGISTIQUE-BACKEND
cp .env.example .env
# Éditer .env si besoin (MySQL, JWT en production)
npm install
```

## Base de données

1. Créer la base `erp_automobile` dans phpMyAdmin (ou en ligne de commande).
2. Exécuter le schéma :
   - Ouvrir `sql/schema.sql` dans phpMyAdmin → onglet SQL → Exécuter.
3. **(Phase 2/3)** Exécuter les migrations : `sql/migration-002-phase2.sql` (proformas, payments), puis `sql/migration-003-compta-devis-factures.sql` (devis/factures : status, client_id, lines, TVA).
4. Créer l’utilisateur admin par défaut :
   ```bash
   npm run seed
   ```
   - **Email** : `admin@erp.bj`
   - **Mot de passe** : `Admin123!`

## Démarrage

```bash
npm run dev
```

API : **http://localhost:3001**

## Endpoints (tous protégés par JWT sauf auth)

### Auth (sans token)
- `POST /auth/login` — Body: `{ email, password }`
- `POST /auth/refresh` — Body: `{ refreshToken }`
- `POST /auth/logout` — Body: `{ refreshToken }`
- `GET /auth/me` — Utilisateur courant (avec token)

### Véhicules
- `GET /vehicles` — Liste (query: search, status, page, limit)
- `GET /vehicles/vin/:vin` — Détail VIN 360° (transitSteps, documents, charges, history)
- `GET /vehicles/:id` — Détail par ID (même structure)
- `POST /vehicles` — Création
- `PATCH /vehicles/:id` — Mise à jour

### Clients
- `GET /clients` — Liste (query: search, page, limit)
- `GET /clients/:id` — Détail + véhicules liés
- `POST /clients` — Création
- `PATCH /clients/:id` — Mise à jour

### Dashboard
- `GET /dashboard/stats` — KPIs (vehiclesInStock, vehiclesInTransit, vehiclesSoldThisMonth, revenueThisMonth)
- `GET /dashboard/charts/status` — Données par statut
- `GET /dashboard/charts/monthly` — Achats vs ventes (query: year, months)

### Transit
- `GET /transit/steps` — Étapes + effectifs
- `GET /transit/vehicles` — Véhicules en transit (query: step, page, limit)

### Reporting
- `GET /reporting/evolution` — CA et marge dans le temps (query: year, months)

### Phase 2 — Documents & VIN 360°
- `GET /vehicles/:vehicleId/documents` — Liste des documents du véhicule
- `POST /vehicles/:vehicleId/documents` — Upload (multipart: file, type, optionnel ocrPayload, operationId)
- `POST /vehicles/:vehicleId/documents/generate-bl` — Génération BL (template) à partir des données transit

### Compta — Charges
- `GET /charges` — Liste globale (page Comptabilité) — query: vehicleId, page, limit, currency
- `GET /vehicles/:vehicleId/charges` — Liste + total (par véhicule)
- `POST /vehicles/:vehicleId/charges` — Ajout (label, amount, currency, chargeType)
- `PATCH /vehicles/:vehicleId/charges/:chargeId` — Modifier
- `DELETE /vehicles/:vehicleId/charges/:chargeId` — Supprimer

### Phase 2 — Étapes de transit (alimentation BL)
- `GET /vehicles/:vehicleId/transit-steps` — Liste
- `POST /vehicles/:vehicleId/transit-steps` — Ajout (stepName, portLoading, portUnloading, vessel, consignee, shipper, etc.)
- `PATCH /vehicles/:vehicleId/transit-steps/:stepId` — Modifier
- `DELETE /vehicles/:vehicleId/transit-steps/:stepId` — Supprimer

### Phase 2 — Proformas
- `GET /vehicles/:vehicleId/proformas` — Liste
- `GET /vehicles/:vehicleId/proformas/:proformaId` — Détail
- `POST /vehicles/:vehicleId/proformas` — Création (estimatedCosts, schedule, generatePdf) + génération PDF

### Compta — Factures & Devis
- `GET /invoices` — Liste (query: vehicleId, status=DEVIS|FACTURE, page, limit)
- `GET /invoices/:id` — Détail (avec lines, client, véhicule)
- `POST /invoices` — Création (vehicleId, amount, status, clientId, lines, tvaRate, invoiceNumber, generatePdf)
- `PATCH /invoices/:id` — Mise à jour (status, clientId, lines, tvaRate, mecefCode, sentAt, etc.)

### Compta — Paiements & Trésorerie
- `GET /payments` — Liste (query: vehicleId, invoiceId, page, limit)
- `POST /payments` — Enregistrer un paiement (vehicleId, invoiceId, amount, paymentType, paidAt, reference)
- `GET /treasury/summary` — Encaissements, décaissements, solde, byCurrency, multipleCurrencies (avertissement multi-devises)

### Utilitaires
- `GET /health` — Statut API
- `GET /api/ping-db` — Test connexion MySQL

## Structure

```
src/
  index.js           # Serveur, montage des routes
  config.js          # JWT, rôles, statuts
  db.js              # Pool MySQL
  middlewares/
    auth.js          # Vérification JWT
    errorHandler.js  # Réponses d’erreur JSON
  routes/
    auth.js
    vehicles.js
    clients.js
    dashboard.js
    transit.js
    reporting.js
    documents.js     # Upload + génération BL
    charges.js
    transitSteps.js
    proformas.js
    invoices.js
    payments.js
    treasury.js
  chargesList.js          # GET /charges (liste globale compta)
sql/
  schema.sql                       # Création des tables (MVP)
  migration-002-phase2.sql        # Proformas, payments
  migration-003-compta-devis-factures.sql # Devis/factures (status, lines, TVA)
scripts/
  seed-user.js            # Utilisateur admin par défaut
```

## Conventions

- Réponses JSON ; erreurs : `{ message, statusCode }`.
- Pagination : `{ data: [...], total }`.
- Auth : header `Authorization: Bearer <accessToken}` sur toutes les routes sauf login/refresh/logout.

**Phase 3 (à venir)** : après agrément SFE DGI, brancher l’appel API DGI dans `POST /invoices` ou un endpoint dédié pour transmettre la facture et enregistrer le code MECeF / QR retourné.

## Dépôt Git

Pour initialiser le projet dans un dépôt Git (depuis la racine du backend) :

```bash
git init
git add .
git commit -m "Initial commit: API ERP Automobile & Logistique (VIN 360°)"
```

Pour pousser vers un dépôt distant (GitHub, GitLab, etc.) :

```bash
git remote add origin <URL_DE_TON_REPO>
git branch -M main
git push -u origin main
```

Le fichier `.env` (et `node_modules`) est ignoré par Git ; seul `.env.example` est versionné.
