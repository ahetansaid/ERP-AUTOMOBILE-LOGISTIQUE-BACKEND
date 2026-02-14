# Branchement de la page Comptabilité sur les API backend

Ce guide décrit comment connecter la page **Comptabilité** du frontend (actuellement en localStorage via `useComptaInterne`) aux API du backend.

---

## 1. Prérequis backend

- **Migration 003** exécutée : `sql/migration-003-compta-devis-factures.sql` (colonnes `status`, `client_id`, `lines`, `tva_rate`, `invoice_number` sur `invoices`).
- **Migration 002** exécutée : tables `payments` et `proformas` (déjà nécessaires pour paiements / trésorerie).

---

## 2. Correspondance onglets ↔ API

| Onglet frontend | Données | Endpoints API |
|-----------------|---------|----------------|
| **Charges** | Liste globale + ajout par véhicule | `GET /charges` (liste), `POST /vehicles/:vehicleId/charges` (création), `PATCH` / `DELETE` sur `.../charges/:chargeId` |
| **Factures & Devis** | Liste + détail + création | `GET /invoices` (filtre `status=DEVIS` ou `FACTURE`), `GET /invoices/:id`, `POST /invoices`, `PATCH /invoices/:id` |
| **Paiements** | Liste + enregistrement | `GET /payments`, `POST /payments` |
| **Trésorerie** | Synthèse | `GET /treasury/summary` |

---

## 3. Endpoints détaillés

### 3.1 Charges

- **Liste (page Comptabilité)**  
  `GET /charges?page=1&limit=50&vehicleId=&currency=`  
  Réponse : `{ data: Charge[], total }`  
  Chaque élément : `id`, `vehicleId`, `label`, `amount`, `currency`, `chargeType`, `createdAt`, `vehicleVin`, `vehicleLabel`.

- **Création** (liée à un véhicule)  
  `POST /vehicles/:vehicleId/charges`  
  Body : `{ label, amount, currency?, chargeType? }`  
  Réponse : objet charge créé.

- **Modification / suppression**  
  `PATCH /vehicles/:vehicleId/charges/:chargeId`  
  `DELETE /vehicles/:vehicleId/charges/:chargeId`

### 3.2 Factures & Devis

- **Liste**  
  `GET /invoices?page=1&limit=20&vehicleId=&status=`  
  `status` : `DEVIS` ou `FACTURE`.  
  Réponse : `{ data: Invoice[], total }` avec `status`, `clientId`, `lines`, `tvaRate`, `invoiceNumber`, `vehicleVin`, `vehicleLabel`, `clientName`.

- **Détail**  
  `GET /invoices/:id`  
  Réponse : facture/devis complet (y compris `lines`, client, véhicule).

- **Création**  
  `POST /invoices`  
  Body : `{ vehicleId, amount?, status?, clientId?, lines?, tvaRate?, invoiceNumber?, generatePdf? }`  
  `status` : `DEVIS` ou `FACTURE`.  
  `lines` : `[{ label, quantity, unitPrice, amount }]`.

- **Mise à jour**  
  `PATCH /invoices/:id`  
  Body partiel : `status`, `clientId`, `lines`, `tvaRate`, `invoiceNumber`, `mecefCode`, `sentAt`, etc.

### 3.3 Paiements

- **Liste**  
  `GET /payments?page=1&limit=20&vehicleId=&invoiceId=`  
  Réponse : `{ data: Payment[], total }`.

- **Création**  
  `POST /payments`  
  Body : `{ vehicleId?, invoiceId?, amount, currency?, paymentType?, paidAt?, reference? }`.

### 3.4 Trésorerie

- **Synthèse**  
  `GET /treasury/summary`  
  Réponse :  
  `{ encaissements, decaissements, solde, currency, byCurrency: [{ currency, encaissements, decaissements, solde }], multipleCurrencies }`  
  Utiliser `multipleCurrencies` (et éventuellement `byCurrency`) pour afficher l’avertissement « plusieurs devises » dans l’onglet Trésorerie.

---

## 4. Stratégie de branchement côté frontend

### Option A : Remplacement complet du localStorage

1. Remplacer les lectures du store `useComptaInterne` par des appels API (avec `Authorization: Bearer <token>`).
2. Pour les **charges** : au chargement de l’onglet, appeler `GET /charges`. Pour l’ajout, appeler `POST /vehicles/:vehicleId/charges` (avec choix du véhicule si besoin).
3. Pour **factures/devis** : `GET /invoices` (avec filtre `status` si deux listes), `POST /invoices` pour la création, `PATCH /invoices/:id` pour modifier (ex. passer un devis en facture).
4. Pour **paiements** : `GET /payments`, `POST /payments`.
5. Pour **trésorerie** : `GET /treasury/summary` ; si `multipleCurrencies === true`, afficher l’avertissement et éventuellement le détail par devise via `byCurrency`.

### Option B : Hybride (API prioritaire, fallback local)

1. Au chargement de la page Comptabilité, tenter d’abord les GET sur les API.
2. En cas d’erreur (réseau ou 401), continuer à utiliser `useComptaInterne` et afficher un message du type « Données locales (backend non connecté) ».
3. Dès que les appels API réussissent, n’utiliser que les données API et ne plus écrire dans le store local pour la compta (ou synchroniser selon votre règle métier).

### Mapping des types (exemple)

- **Charge (front)** : `category` → `chargeType`, `vehicle` → `vehicleId` (et appel `POST /vehicles/:vehicleId/charges`).
- **Facture / Devis (front)** : `client` → `clientId`, `lignes` → `lines`, `statut` → `status` (`DEVIS` | `FACTURE`), `TVA` → `tvaRate`.
- **Paiement (front)** : `méthode` → `paymentType`, `référence` → `reference`, `facture liée` → `invoiceId`.

---

## 5. Résumé des ajouts backend pour la compta

| Élément | Fichier / route |
|--------|------------------|
| Liste globale des charges | `GET /charges` — `src/routes/chargesList.js` |
| Trésorerie par devise | `GET /treasury/summary` — champs `byCurrency`, `multipleCurrencies` dans `src/routes/treasury.js` |
| Devis / factures (statut, lignes, TVA) | Migration 003 + `GET/POST/PATCH /invoices` avec `status`, `clientId`, `lines`, `tvaRate` dans `src/routes/invoices.js` |

Toutes les routes sont protégées par JWT ; envoyer le token dans le header `Authorization: Bearer <accessToken>`.
