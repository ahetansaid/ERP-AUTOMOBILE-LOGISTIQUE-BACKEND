# Point Frontend — ERP Automobile & Logistique

**Date** : Février 2025  
**Backend** : Node.js + Express + MySQL (port 3001)  
**Frontend** : Next.js (rapport API)

Ce document fait le point sur ce que le backend fournit par rapport aux attentes du frontend et ce qu’il reste à brancher côté interface.

---

## 1. Configuration côté frontend

- **Base URL** : `NEXT_PUBLIC_API_URL` (ex. `http://localhost:3001`) — **sans** préfixe `/api` pour les ressources métier.
- **Auth** : envoyer le JWT dans tous les appels protégés :
  ```http
  Authorization: Bearer <accessToken>
  ```
- **Login** : `POST /auth/login` avec `{ email, password }` → réponse `{ accessToken, refreshToken, expiresIn: 900, user }`.
- **Utilisateur par défaut** (après `npm run seed`) : `admin@erp.bj` / `Admin123!`

---

## 2. Alignement rapport API ↔ backend

### 2.1 Auth (§2 rapport)

| Endpoint | Rapport API | Backend | Remarque |
|----------|-------------|---------|----------|
| `POST /auth/login` | accessToken, refreshToken, expiresIn, user | ✅ | user: id, email, firstName, lastName, role |
| `POST /auth/refresh` | Même forme que login | ✅ | Body: { refreshToken } |
| `POST /auth/logout` | { success: true } | ✅ | Body: { refreshToken } |
| `GET /auth/me` | User courant | ✅ | Protégé par token |

**Rôles** : `SUPER_ADMIN`, `ADMIN`, `COMPTABLE`, `AGENT_TRANSIT`, `COMMERCIAL`, `CLIENT`.

### 2.2 Véhicules (§3 rapport)

| Endpoint | Rapport API | Backend | Remarque |
|----------|-------------|---------|----------|
| `GET /vehicles` | data[], total, query search, status, page, limit | ✅ | Aligné |
| `GET /vehicles/:id` | Détail véhicule | ✅ | Enrichi : transitSteps, documents, charges, history, totalCost, margin, marginRate |
| `GET /vehicles/vin/:vin` | Détail par VIN (VIN 360°) | ✅ | Même structure enrichie |
| `POST /vehicles` | vin, chassisNumber, brand, model, year, vehicleType | ✅ | 201 + objet créé |
| `PATCH /vehicles/:id` | Champs partiels | ✅ | 200 + objet mis à jour |

**Statuts véhicule** : `ACHETE`, `EN_TRANSIT`, `ARRIVE_PORT`, `EN_DOUANE`, `DEDOUANE`, `LIVRE`, `VENDU`.

### 2.3 Clients (§4 rapport)

| Endpoint | Rapport API | Backend | Remarque |
|----------|-------------|---------|----------|
| `GET /clients` | data[], total, search, page, limit | ✅ | Aligné |
| `GET /clients/:id` | Détail + optionnel vehicles | ✅ | Champ `vehicles` (liste) inclus |
| `POST /clients` | name, email, phone, address | ✅ | 201 |
| `PATCH /clients/:id` | Champs partiels | ✅ | 200 |

### 2.4 Dashboard (§5 rapport)

| Endpoint | Rapport API | Backend | Remarque |
|----------|-------------|---------|----------|
| `GET /dashboard/stats` | vehiclesInStock, vehiclesInTransit, vehiclesSoldThisMonth, revenueThisMonth, currency | ✅ | Aligné |
| `GET /dashboard/charts/status` | data: [{ name, count }] | ✅ | name = libellé FR (Achetés, En transit, …) |
| `GET /dashboard/charts/monthly` | data: [{ month, achats, ventes }] | ✅ | Query: months (défaut 6) |

### 2.5 Transit (§6 rapport)

| Endpoint | Rapport API | Backend | Remarque |
|----------|-------------|---------|----------|
| `GET /transit/steps` | steps: [{ step, count }] | ✅ | step = libellé (Achat, Transit maritime, …) |
| `GET /transit/vehicles` | Liste véhicules (step, page, limit) | ✅ | data[], total, currentStep sur chaque véhicule |

### 2.6 Reporting (§8 rapport)

| Endpoint | Rapport API | Backend | Remarque |
|----------|-------------|---------|----------|
| `GET /reporting/evolution` | data: [{ month, ca, marge }] | ✅ | Query: months. ca/marge en M (arrondis) |

### 2.7 VIN 360° (§9 rapport)

La page détail véhicule (`/parc-auto/[vin]` ou équivalent) peut s’appuyer sur :

- **Une seule requête** : `GET /vehicles/vin/:vin` ou `GET /vehicles/:id` → réponse avec `transitSteps`, `documents`, `charges`, `totalCost`, `margin`, `marginRate`, `history`.
- Aucun mock nécessaire : tout est renvoyé par le backend.

---

## 3. Conventions respectées par le backend

- **Réponses** : JSON.
- **Erreurs** : `{ message: string, statusCode: number }` (ex. 400, 401, 404).
- **Listes paginées** : `{ data: [], total: number }`.
- **IDs** : renvoyés en string (ex. `"id": "42"`).

---

## 4. Endpoints Phase 2/3 (à brancher côté front si besoin)

Le frontend peut progressivement consommer ces routes pour la vue VIN 360° et la compta.

| Domaine | Méthode | Chemin | Usage possible |
|---------|---------|--------|-----------------|
| Documents | GET | `/vehicles/:vehicleId/documents` | Onglet Documents fiche véhicule |
| Documents | POST | `/vehicles/:vehicleId/documents` | Upload (multipart: file, type) |
| Documents | POST | `/vehicles/:vehicleId/documents/generate-bl` | Bouton « Générer BL » |
| Charges | GET | `/vehicles/:vehicleId/charges` | Onglet Charges / rentabilité |
| Charges | POST | `/vehicles/:vehicleId/charges` | Ajout d’une charge |
| Charges | PATCH/DELETE | `.../charges/:chargeId` | Édition / suppression |
| Transit steps | GET/POST/PATCH/DELETE | `/vehicles/:vehicleId/transit-steps` | Saisie étapes transit (pour BL) |
| Proformas | GET/POST | `/vehicles/:vehicleId/proformas` | Proformas + génération PDF |
| Factures | GET/POST/PATCH | `/invoices` | Liste factures, création (vehicleId, amount, generatePdf) |
| Paiements | GET/POST | `/payments` | Liste / enregistrement paiements |
| Trésorerie | GET | `/treasury/summary` | Encaissements, décaissements, solde |

---

## 5. Checklist intégration frontend

- [ ] `NEXT_PUBLIC_API_URL` pointant vers le backend (ex. `http://localhost:3001`).
- [ ] Client API : header `Authorization: Bearer <token>` sur toutes les requêtes sauf login/refresh/logout.
- [ ] Gestion 401 : redirection login ou appel `POST /auth/refresh` avec `refreshToken`.
- [ ] Stockage : accessToken, refreshToken, user (localStorage ou cookie sécurisé).
- [ ] Types (ex. `src/types/index.ts`) alignés avec les réponses (Vehicle avec transitSteps, documents, charges, etc.).
- [ ] Pages principales : login → dashboard, parc auto (liste + détail VIN), clients, transit, reporting.
- [ ] Optionnel : écrans Phase 2 (documents, charges, proformas, factures, trésorerie).

---

## 6. Référence rapide des formats de réponse

- **Login** : `{ accessToken, refreshToken, expiresIn: 900, user: { id, email, firstName, lastName, role } }`
- **Liste véhicules** : `{ data: Vehicle[], total }`
- **Détail véhicule (VIN 360°)** : objet Vehicle + `transitSteps[]`, `documents[]`, `charges[]`, `totalCost`, `margin`, `marginRate`, `history[]`
- **Dashboard stats** : `{ vehiclesInStock, vehiclesInTransit, vehiclesSoldThisMonth, revenueThisMonth, currency }`
- **Erreur** : `{ message, statusCode }`

---

En résumé : le backend est aligné avec le **rapport API** pour auth, véhicules, clients, dashboard, transit et reporting. La vue **VIN 360°** est entièrement alimentée par `GET /vehicles/vin/:vin` (ou `/:id`). Les endpoints **Phase 2/3** (documents, charges, transit-steps, proformas, factures, paiements, trésorerie) sont disponibles pour être branchés côté frontend quand les écrans sont prêts.
