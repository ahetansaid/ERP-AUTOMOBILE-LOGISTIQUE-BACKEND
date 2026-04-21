# Briefing général backend — ParcAuto Manager

**Document** : Synthèse des attentes du frontend à l’égard du backend, après implémentation complète du plan d’implémentation frontend.  
**Usage** : Aligner l’API, les formats de réponse et les règles métier côté backend.  
**Références** : `PLAN_IMPLEMENTATION_FRONTEND.md`, CDC, Cartographie des processus.

---

## 1. Principes généraux

- **Base URL** : le frontend appelle une seule base (ex. `NEXT_PUBLIC_API_URL`, défaut `http://localhost:3001`). Toutes les routes ci‑dessous sont relatives à cette base.
- **Authentification** : envoi systématique de `Authorization: Bearer <accessToken>`. En 401, le frontend tente un refresh via `POST /auth/refresh` avec `refreshToken`, puis refait la requête. En échec, redirection vers `/login`.
- **Multi‑tenant** : si une route nécessite la société, le frontend peut envoyer `companyId` en query ou en body ; le backend peut aussi déduire `companyId` du JWT (`req.user.companyId`). **À éviter** : liste vide lorsque `companyId` est absent ; préférer déduire du JWT.
- **Format des réponses** : **snake_case** (noms de colonnes BDD) pour cohérence et alignement avec le frontend (helpers `pick` / normaliseurs). Erreurs 4xx : `{ "message": "...", "statusCode": 401 }` (ou 400, 403, 404, 409).
- **Pagination** : listes paginées avec forme du type  
  `{ "data": [...] | "purchases": [...] | "clients": [...], "pagination": { "currentPage", "totalPages", "totalItems", "itemsPerPage" } }`.

---

## 2. Auth

| Méthode | Route | Body / Query | Réponse attendue |
|--------|--------|--------------|------------------|
| POST | `/auth/login` | `{ email, password }` | 200 : `{ user: { id, email, firstName, lastName, role, companyId }, accessToken, refreshToken, expiresIn }` |
| POST | `/auth/refresh` | `{ refreshToken }` | 200 : `{ accessToken, expiresIn }` (optionnel : `refreshToken` renouvelé) |
| POST | `/auth/logout` | (optionnel body) | 200 ou 204 |

Erreurs : `{ message, statusCode }`. Pas de champ `error` seul pour login/refresh/logout.

---

## 3. Dashboard

| Méthode | Route | Réponse attendue |
|--------|--------|-------------------|
| GET | `/dashboard/stats` | 200 : `{ stockDisponible, stockNonRegulier, stockRegularise, nombreClients, caSemaine, caMois, vehiclesEnMaintenance, vehiclesEnTransit, currency? }` |

Tous les champs en **camelCase** pour le dashboard (déjà utilisé côté frontend). Pas d’obligation d’exposer `alertesActives` si non implémenté.

---

## 4. Véhicules

| Méthode | Route | Body / Query | Réponse / Comportement |
|--------|--------|---------------|-------------------------|
| GET | `/vehicles` | Query : `status`, `search`, pagination | 200 : `{ data: [ { id, vin, brand, model, year, color, status, purchase_price, **purchase_price_fcfa**, **purchasePriceFcfa** (équivalent FCFA pour la colonne Prix d’achat), price_sale, client_id, client_name, remaining_amount, paid_amount, ... } ], pagination? }` |
| GET | `/vehicles/:id` | — | 200 : objet véhicule (snake_case) + `purchase_price_fcfa`, `purchasePriceFcfa`, `remaining_amount`, `paid_amount` |
| PATCH | `/vehicles/:id` | `{ status?, price_sale?, client_id? }` | 200 : véhicule mis à jour. **Règles** : `EN_MAINTENANCE` → `DISPONIBLE` refusé (409) si aucun reçu lié au devis ; `EN_VENTE` → `VENDU` refusé (409) si solde facture ≠ 0. **VENDU** → **LIVRE** : autorisé pour « Marquer sortie du parc » (livraison physique). |
| GET | `/vehicles/:id/timeline` | — | 200 : `{ timeline: [ { type, date, description, author? } ] }` (optionnel) |

**Statuts véhicule** : `DISPONIBLE`, `EN_VENTE`, `VENDU`, `EN_MAINTENANCE`, `EN_TRANSIT`, `LIVRE`, etc. (alignés CDC).  
Pour **stock non régulier**, les véhicules exposent **remaining_amount** et **paid_amount** (calculés à partir des factures/reçus) pour activer/désactiver le bouton « Clôturer la vente ». **Contrat** : si le véhicule n’a pas de facture, l’API renvoie `remaining_amount: null` et `paid_amount: null` (solde inconnu → bouton désactivé). Si une facture existe, ce sont des nombres (solde = 0 → bouton activé). Aliases renvoyés : `remainingAmount`, `solde_restant`, `remaining_balance` ; `paidAmount`.

---

## 5. Achats (Purchases)

| Méthode | Route | Body / Query | Réponse / Comportement |
|--------|--------|---------------|-------------------------|
| GET | `/purchases` | Query : `companyId` (optionnel si JWT) | 200 : `{ purchases: [ ...tous champs achat (id, company_id, supplier_name, fournisseurNom, purchase_date, container_reference, vessel, purchase_type, currency, status, created_at, updated_at), vehicle_count ] }`. |
| GET | `/purchases/:id` | — | 200 : `{ purchase: { ...tous champs achat, fournisseurNom, vehicle_count }, vehicles: [ ... ] }`. Chaque véhicule inclut **purchase_price_fcfa** (et alias) pour « Prix achat (FCFA) ». Infos liées à l’achat. |
| POST | `/purchases` | Body : toutes les infos liées à l’achat. **Achat** : fournisseurNom (obligatoire), dateAchat / purchase_date, conteneur / container_reference, navire / vessel, typeAchat / purchase_type (VRAC|CONTENEUR), devise / currency. **Véhicules** : tableau `vehicles` ou `vehicules`, chaque élément : vin, brand/marque, model/modele, year/annee, color/couleur, purchase_price/prix_achat, **purchase_price_fcfa** / purchasePriceFcfa / montant_fcfa / montantFCFA (équivalent FCFA persistant), price_sale/prix_vente. | 201 : `{ message, purchase, vehicles }` avec **purchase_price_fcfa** et alias sur chaque véhicule. |
| PATCH | `/purchases/:id` | Body : fournisseurNom, purchase_date, container_reference, vessel, purchase_type, currency ; optionnel : **vehicles** (tableau) avec pour chaque véhicule **id** ou **vehicle_id** et **purchase_price_fcfa** (ou alias) pour mettre à jour l'équivalent FCFA. | 200 : achat mis à jour. Modif autorisée **uniquement** si `status === 'EN_COURS'`. |
| PATCH | `/purchases/:id/arrive` | Body optionnel | 200 : statut achat → ARRIVÉ ; véhicules liés passent en **DISPONIBLE** (pas EN_TRANSIT). |
| DELETE | `/purchases/:id` | Body optionnel : `{ reason }` | 200/204. Suppression autorisée **uniquement** si `status === 'EN_COURS'`. **Important** : l’URL doit contenir l’**id** (pas `DELETE /purchases/` sans id). |

---

## 6. Fournisseurs (Suppliers)

| Méthode | Route | Réponse attendue |
|--------|--------|-------------------|
| GET | `/suppliers` | 200 : `{ suppliers: [ { id, name, contact_name, email, phone, ... } ], pagination? }`. **Formulaire achat** : le fournisseur est un champ texte (fournisseurNom), pas d’appel à `/suppliers` pour ce formulaire. |

---

## 7. Clients

| Méthode | Route | Body / Réponse |
|--------|--------|----------------|
| GET | `/clients` | 200 : `{ clients: [ { id, name, email, phone, address, city, country, status, ... } ], pagination? }` |
| GET | `/clients/:id` | 200 : `{ client: { ... }, purchaseHistory?, paymentHistory?, transitHistory? }` |
| POST | `/clients` | Body : name, email, phone, address, city, country, notes?, status? → 201 |
| PATCH | `/clients/:id` | Body optionnel : name, email, phone, address, city, country, notes, status. 200 : client mis à jour. 404 si introuvable. |
| DELETE | `/clients/:id` | Body optionnel : `{ reason: string }`. 204. Refusé (409) si le client a des factures ou véhicules liés. |

---

## 8. Comptabilité

### Charges
- **GET** `/charges` → `{ charges: [ { id, label, category, amount, charge_date, ... } ], pagination? }`
- **POST** `/charges` → Body : label, category, amount, chargeDate (ou charge_date) → 201
- **DELETE** `/charges/:id` → Body optionnel : `{ reason }` → 200/204

### Devis (atelier)
- **GET** `/devis` → `{ workshopQuotes: [ { id, vehicle_id, prestataire, amount, currency, valid_until, status, vin, brand, model, ... } ], pagination? }`
- **POST** `/devis` → Body : vehicleId, prestataire, amount, currency, description?, validUntil?, companyId? → 201. Un seul devis actif par véhicule (refus si doublon).

### Factures
- **GET** `/invoices` → `{ invoices: [ { id, vehicle_id, client_id, total_amount, due_date, status, invoice_number, client_name, vin, paid_amount, remaining_amount, ... } ], pagination? }`
- **POST** `/invoices` → Body : vehicleId, clientId, amount, dueDate? → 201. Numérotation auto (ex. FAV-2026-0001).
- **PATCH** `/invoices/:id` → Body optionnel : `vehicleId`, `clientId`, `amount`/`total_amount`, `dueDate`. 200. **Refusé (409)** si au moins un reçu a été émis (`paid_amount > 0`) : *« Un reçu a déjà été émis pour cette facture. Modification impossible. »*
- **DELETE** `/invoices/:id` → Body optionnel : `{ reason: string }`. 204. **Refusé (409)** si `paid_amount > 0` : *« Un reçu a déjà été émis pour cette facture. Suppression impossible. »*

### Reçus
- **GET** `/receipts` → `{ receipts: [ { id, invoice_id?, devis_id?, source_type ("FACTURE"|"DEVIS"), amount, payment_method, payment_date, reference, invoice_number?, **client_name** (reçu facture), **clientName**, **client**, **devis_prestataire** (reçu devis), **devisPrestataire**, **prestataire**, **workshop_prestataire**, **devis_vin**? } ], pagination? }`.
- **POST** `/receipts` → Voir **`docs/FORMAT_RECETTES_FRONTEND.md`**. Body : invoiceId ou devisId + amount (+ optionnels). 201.
- **PATCH** `/receipts/:id` → Body optionnel : `amount`, `paymentMethod`/`payment_method`, `paymentDate`/`payment_date`, `reference`. 200 : reçu mis à jour. 404 si introuvable.
- **DELETE** `/receipts/:id` → Body optionnel : `{ reason: string }` (motif de suppression). 204. Pas de condition (suppression autorisée).

### Trésorerie
- **GET** `/treasury` : query optionnelle **`period`** = `week` | `month` | `year` (ou `hebdo` | `mensuel` | `annuel`) pour filtrer par période ; sans `period` = tout. Réponse : `{ total_entrees, total_sorties, solde, benefice, transactions?, pagination? }`. **transactions** : liste (encaissements + décaissements) avec type, amount, date, reference/label.

### Pro forma
- **GET** `/proformas` → `{ proformas: [ { id, vehicle_id, client_id, amount, total_amount, proforma_number, status, client_name, vin, brand, model, ... } ], pagination? }`

### Rapports
- **GET** `/reports` (ou équivalent) → `{ reports: [ { id, name, type, created_at } ] }` pour liste des rapports générés. Téléchargement PDF via URL dédiée si disponible.

---

## 9. Transit

- **GET** `/transit/steps/summary` → `{ steps: [ { step: "ARRIVEE_PORT" | "ADMISSION_TEMPORAIRE" | ... | "LIVRE", count: number } ] }`
- **GET** `/transit/steps` → `{ transitSteps: [ { id, vehicle_id, step_name, date_arrival, date_departure, vin, brand, model, ... } ], pagination? }`
- **GET** `/transit/vehicles` (optionnel) → liste des véhicules en transit

Étapes attendues (workflow CDC) : ARRIVEE_PORT, ADMISSION_TEMPORAIRE, DECLARATION_DOUANE, MAINLEVEE, SCELLES_POSES, EN_ACHEMINEMENT, LIVRE.

---

## 10. Utilisateurs

- **GET** `/users` → `{ users: [ { id, email, first_name, last_name, role, is_active, created_at } ], pagination? }` (réservé Admin).
- **POST** `/users` → Body : email, password, firstName, lastName, role, companyId? → 201.

---

## 11. Paramètres / Settings

- **GET** `/settings/rates` (ou équivalent) → `{ rates: { USD?: number, EUR?: number } }` pour taux FCFA.
- **PUT** `/settings/rates` → Body : `{ USD, EUR }` → 200.

---

## 12. Notifications

- **GET** `/notifications` → `{ notifications: [ { id, type, title, message, read, created_at } ], pagination? }`

---

## 13. Règles métier critiques (à garantir côté backend)

1. **Clôture vente** : le passage du véhicule de `EN_VENTE` à `VENDU` est autorisé **uniquement** si la somme des reçus liés à la facture du véhicule ≥ montant total de la facture. Sinon retour **409** avec message explicite.
2. **Clôture maintenance** : le passage du véhicule de `EN_MAINTENANCE` à `DISPONIBLE` est autorisé **uniquement** si au moins un reçu lié au devis de maintenance a été émis (devis clôturé). Sinon **409**.
3. **Achats** : modification et suppression possibles **uniquement** si `status === 'EN_COURS'`. À la validation arrivée (`/purchases/:id/arrive`), les véhicules liés passent en **DISPONIBLE**.
4. **Devis atelier** : un seul devis actif par véhicule (contrainte ou refus explicite en création).

---

## 14. Récapitulatif des routes par module

| Module | Routes principales |
|--------|--------------------|
| Auth | POST /auth/login, /auth/refresh, /auth/logout |
| Dashboard | GET /dashboard/stats |
| Véhicules | GET/PATCH /vehicles, GET /vehicles/:id, GET /vehicles/:id/timeline |
| Achats | GET/POST /purchases, GET/PATCH/DELETE /purchases/:id, PATCH /purchases/:id/arrive |
| Fournisseurs | GET /suppliers |
| Clients | GET/POST /clients, GET /clients/:id |
| Charges | GET/POST /charges, DELETE /charges/:id |
| Devis | GET/POST /devis |
| Factures | GET/POST /invoices |
| Reçus | GET/POST /receipts |
| Trésorerie | GET /treasury |
| Pro forma | GET /proformas |
| Rapports | GET /reports (ou équivalent) |
| Transit | GET /transit/steps/summary, GET /transit/steps |
| Utilisateurs | GET/POST /users |
| Paramètres | GET/PUT /settings/rates (ou équivalent) |
| Notifications | GET /notifications |

---

## 15. CORS et déploiement

- Autoriser l’origine du frontend (ex. `http://localhost:3000` en dev, origine de production en prod).
- Headers : `Access-Control-Allow-Credentials: true` si cookies/auth utilisés, et méthodes/headers attendus.

---

*Ce briefing résume les contrats d’API et règles métier attendus par le frontend ParcAuto Manager. Toute évolution côté backend (nouveaux champs, nouveaux statuts, nouvelles routes) doit être documentée pour mise à jour des appels et des normaliseurs côté frontend.*
