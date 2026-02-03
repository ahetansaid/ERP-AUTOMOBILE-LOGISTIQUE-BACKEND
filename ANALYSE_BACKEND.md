# Analyse du backend — ERP Automobile & Logistique

**Date** : Février 2025  
**Contexte** : Spécification VIN 360° + Rapport API attendue par le frontend

---

## 1. État actuel du backend

### 1.1 Stack technique

| Élément | État |
|--------|------|
| **Runtime** | Node.js (ES modules) |
| **Framework** | Express 4.21 |
| **Base de données** | MySQL (mysql2, pool) |
| **CORS** | Configuré (FRONTEND_URL) |
| **Auth (JWT)** | ❌ Absent |
| **Schéma SQL / migrations** | ❌ Aucun fichier |

### 1.2 Routes existantes

| Méthode | Chemin | Usage |
|---------|--------|--------|
| GET | `/health` | Health check (statut API) |
| GET | `/api/ping-db` | Test connexion MySQL |

**Remarque** : Le frontend attend une **base URL** sans préfixe `/api` pour les ressources métier (ex. `GET /vehicles`, `POST /auth/login`). Les routes actuelles ne correspondent pas aux attentes du rapport API.

### 1.3 Structure des dossiers

```
src/
  index.js   # Serveur + routes (tout dans un fichier)
  db.js      # Pool MySQL + helper query()
```

Il n’y a pas de séparation par domaine (auth, vehicles, clients, dashboard, transit, etc.), ni de middlewares dédiés (auth, validation), ni de couche « repository » ou « service ».

---

## 2. Écart par rapport au rapport API (frontend)

Le frontend **ne mocke aucune donnée** et attend les endpoints ci‑dessous. Aujourd’hui **aucun** de ces endpoints n’existe côté backend.

### 2.1 Authentification (§2 du rapport)

| Endpoint | Attendu | Backend |
|----------|---------|--------|
| `POST /auth/login` | accessToken, refreshToken, expiresIn, user | ❌ |
| `POST /auth/refresh` | Nouveau token | ❌ |
| `POST /auth/logout` | { success: true } | ❌ |
| `GET /auth/me` | User courant (optionnel) | ❌ |

**Manques** : tables `users` (et éventuellement `refresh_tokens`), génération JWT, vérification mot de passe, middleware `Authorization: Bearer <token>`.

### 2.2 Véhicules — Parc automobile (§3)

| Endpoint | Attendu | Backend |
|----------|---------|--------|
| `GET /vehicles` | Liste + pagination, filtres search, status | ❌ |
| `GET /vehicles/:id` ou `GET /vehicles/vin/:vin` | Détail + optionnel transitSteps, documents, charges | ❌ |
| `POST /vehicles` | Création (vin, brand, model, year, etc.) | ❌ |
| `PATCH /vehicles/:id` | Mise à jour partielle | ❌ |

**Statuts attendus** : `ACHETE`, `EN_TRANSIT`, `ARRIVE_PORT`, `EN_DOUANE`, `DEDOUANE`, `LIVRE`, `VENDU`.

### 2.3 Clients — CRM (§4)

| Endpoint | Attendu | Backend |
|----------|---------|--------|
| `GET /clients` | Liste + search, page, limit | ❌ |
| `GET /clients/:id` | Détail (optionnel vehicles) | ❌ |
| `POST /clients` | Création | ❌ |
| `PATCH /clients/:id` | Mise à jour | ❌ |

### 2.4 Dashboard (§5)

| Endpoint | Attendu | Backend |
|----------|---------|--------|
| `GET /dashboard/stats` | vehiclesInStock, vehiclesInTransit, vehiclesSoldThisMonth, revenueThisMonth, currency | ❌ |
| `GET /dashboard/charts/status` | Données par statut (graphique) | ❌ |
| `GET /dashboard/charts/monthly` | Achats vs ventes par mois | ❌ |

### 2.5 Transit & Douane (§6)

| Endpoint | Attendu | Backend |
|----------|---------|--------|
| `GET /transit/steps` | Étapes + count (Achat, Embarquement, etc.) | ❌ |
| `GET /transit/vehicles` | Liste véhicules en transit (filtre step, pagination) | ❌ |

### 2.6 Comptabilité (§7 — optionnel MVP)

| Endpoint | Attendu | Backend |
|----------|---------|--------|
| `GET /vehicles/:id/charges` | Charges par véhicule | ❌ |
| `GET /invoices`, `POST /invoices`, `GET /invoices/:id` | Devis / factures | ❌ |
| `GET /payments`, `POST /payments` | Paiements | ❌ |
| `GET /treasury/summary` | Trésorerie | ❌ |

### 2.7 Reporting (§8)

| Endpoint | Attendu | Backend |
|----------|---------|--------|
| `GET /reporting/evolution` | CA et marge dans le temps | ❌ |

### 2.8 VIN 360° (§9)

La page détail véhicule s’appuie sur :

- `GET /vehicles/vin/:vin` ou `GET /vehicles/:id` avec **sous-objets** : `transitSteps`, `documents`, `charges`, `history` (ou endpoints dédiés `/vehicles/:id/transit`, `/vehicles/:id/documents`, etc.).

Aucun de ces comportements n’est implémenté.

---

## 3. Écart par rapport à la spécification VIN 360°

### 3.1 Modèle de données (spec §7)

La spec décrit un modèle conceptuel. Côté backend il n’existe **aucune table** ni script de création.

| Entité | Champs principaux (spec) | Tables SQL à créer |
|--------|--------------------------|--------------------|
| **Vehicle** | id, vin (unique), chassisNumber, marque, modèle, année, type, statut, client_id, purchasePrice, salePrice, currency, etc. | `vehicles` |
| **Document** | id, vehicle_id, type (BL, FACTURE_ACHAT, QUITTANCE, FACTURE_MECEF, PROFORMA…), fileStoragePath, ocrPayload (JSON), generatedFromTemplate, operation_id | `documents` |
| **TransitStep / Operation** | Lié véhicule ; ports, date arrivée, navire, consignataire (aligné BL) | `transit_steps` ou `operations` |
| **Invoice (MECeF)** | id, vehicle_id, mecefCode, qrCodePath, pdfPath, sentAt | `invoices` (ou intégré dans documents) |
| **Proforma** | id, vehicle_id, estimatedCosts (JSON), schedule, pdfPath | `proformas` (ou type document) |
| **User** | id, email, password (hash), firstName, lastName, role | `users` (+ évent. `refresh_tokens`) |
| **Client** | id, name, email, phone, address | `clients` |

### 3.2 Fonctionnalités spec non couvertes par le backend

- **Documents** : stockage par VIN, types (BL, facture, quittance, MECeF, proforma), OCR (payload JSON), liaison à une opération, **génération** (BL, proforma, facture MECeF).
- **Connaissement Maritime (BL)** : structure §3.2 (champs OCR + génération) — pas de tables ni endpoints dédiés.
- **Proformas internes** : génération à partir des données véhicule + paramètres de coûts — pas d’API ni de modèle.
- **Facturation MECeF** : conformité DGI Bénin, QR code, code fiscal — pas d’intégration ni d’agrément SFE.
- **OCR** : extraction BL / factures / quittances — pas de service ni de stockage `ocrPayload`.

---

## 4. Synthèse des écarts

| Domaine | Routes attendues | Implémenté | Tables / modèle |
|---------|------------------|------------|------------------|
| Auth | 4 | 0 | 0 |
| Véhicules | 4+ | 0 | 0 |
| Clients | 4 | 0 | 0 |
| Dashboard | 3 | 0 | 0 |
| Transit | 2 | 0 | 0 |
| Reporting | 1 | 0 | 0 |
| Compta (optionnel) | plusieurs | 0 | 0 |
| Documents / VIN 360° | via vehicles ou dédiés | 0 | 0 |

**Conclusion** : Le backend actuel est un **squelette** (Express + MySQL + 2 routes de santé). Aucun endpoint métier ni schéma de base n’est en place. Il faut tout construire pour être aligné avec le frontend et la spec VIN 360°.

---

## 5. Recommandations

### 5.1 Priorisation (alignée rapport API §10)

1. **Auth** : `POST /auth/login`, `POST /auth/refresh`, tables `users` (+ rôles), JWT, middleware auth.
2. **Véhicules** : `GET /vehicles`, `GET /vehicles/vin/:vin` (ou `:id`), `POST /vehicles`, `PATCH /vehicles/:id` + table `vehicles`.
3. **Clients** : `GET /clients`, `GET /clients/:id`, `POST /clients`, `PATCH /clients/:id` + table `clients`.
4. **Dashboard** : `GET /dashboard/stats`, `GET /dashboard/charts/status`, `GET /dashboard/charts/monthly`.
5. **Transit** : `GET /transit/steps`, `GET /transit/vehicles`.
6. **Reporting** : `GET /reporting/evolution`.
7. **VIN 360°** : enrichir `GET /vehicles/vin/:vin` avec `transitSteps`, `documents`, `charges`, `history` (ou endpoints séparés).

### 5.2 Structure backend recommandée

- **Base URL** : pas de préfixe `/api` pour les ressources métier (comme attendu par le front : `/auth/*`, `/vehicles`, etc.). Garder éventuellement `/api/ping-db` pour le debug.
- **Dossiers** :  
  `src/routes/` (auth, vehicles, clients, dashboard, transit, reporting),  
  `src/middlewares/` (auth.js, errorHandler.js),  
  `src/controllers/` ou logique dans les routes,  
  `src/db/` ou `src/repositories/` pour les requêtes SQL.
- **Schéma SQL** : fichier(s) `migrations/` ou `sql/schema.sql` pour créer les tables (users, vehicles, clients, documents, transit_steps, etc.) en cohérence avec la spec §7.

### 5.3 Conventions à respecter pour le frontend

- Réponses JSON.
- Erreurs : `{ "message": "string", "statusCode": number }`.
- Pagination : `{ data: [...], total: number }` pour listes.
- Auth : header `Authorization: Bearer <accessToken>` sur toutes les routes protégées (sauf login/refresh).

### 5.4 Roadmap spec VIN 360° (§8)

- **MVP** : VIN clé unique, stockage documents par VIN, liaison document ↔ opération, OCR BL (champs essentiels). → À traduire en tables + endpoints + logique métier.
- **Phase 2** : Génération BL (template), proformas, préparation facture MECeF (modèle + QR/code).
- **Phase 3** : Agrément SFE, intégration API DGI, facture MECeF complète.

Le backend actuel ne couvre aucune de ces phases ; la première étape est de poser le modèle de données (vehicles, clients, users, documents, transit) et les endpoints prioritaires listés au §5.1.

---

## 6. Prochaines étapes suggérées

1. Créer le schéma SQL (users, vehicles, clients, documents, transit_steps, etc.) et l’exécuter sur la base `erp_automobile`.
2. Implémenter l’auth (inscription/login optionnel, login + JWT + refresh + middleware).
3. Implémenter les CRUD véhicules et clients + GET par VIN.
4. Ajouter les routes dashboard (stats, charts) et transit (steps, vehicles).
5. Ajouter la route reporting/evolution.
6. Enrichir le détail véhicule (transitSteps, documents, charges, history) pour la vue VIN 360°.
7. Introduire la gestion des documents (types, stockage, ocrPayload, liaison opération) puis, en phase 2, génération BL et proformas.

Ce document peut servir de référence pour l’implémentation pas à pas du backend en restant aligné avec la spec et le frontend.
