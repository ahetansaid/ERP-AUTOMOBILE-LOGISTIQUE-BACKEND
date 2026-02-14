# Résumé spec fonctionnelle — Pour le frontend

Document de référence pour l’équipe frontend : ce qui a été mis en place côté backend selon la [spec fonctionnelle (Stock, CRM, Transit, Compta)](./SPEC_FONCTIONNELLE_GESTION_STOCK_CRM_TRANSIT_COMpta.md), et comment l’utiliser dans l’interface.

---

## 1. Parc automobile — Gestion du stock

### 1.1 Sous-menus à afficher

| Sous-menu | Description | API à appeler |
|-----------|-------------|----------------|
| **Stock disponible (régularisé)** | Véhicules dont le client a payé selon la compta | `GET /vehicles/stock/disponible` |
| **Stock non régularisé** | Véhicules en attente de paiement (partiel ou non enclenché) | `GET /vehicles/stock/non-regularise` |

**Paramètres optionnels (stock disponible)** : `nature` = `DEPOT` \| `TRANSIT` \| `AUTRES` pour filtrer par nature du stock.

**Réponse (liste)** : pour chaque véhicule, le backend renvoie notamment :
- VIN, marque, modèle, année, statut, client
- **numeroBl**, **dateEntreePort**, **dateEntreeParc**, **natureStock**, **regularise**
- **joursSurParc** (calculé côté backend)

### 1.2 Liste / détail véhicule (tous écrans)

Pour **tous** les écrans véhicules (liste générale, détail, formulaire d’édition), les champs suivants sont disponibles :

- Infos véhicule : VIN, marque, modèle, année, type, statut, client
- **Numéro BL** : `numeroBl`
- **Date d’entrée au Port** : `dateEntreePort`
- **Date d’entrée au Parc** : `dateEntreeParc`
- **Jours sur le parc** : fourni par les endpoints stock ; en liste générale, à calculer côté front si besoin à partir de `dateEntreeParc`
- **Régularisé** : `regularise` (booléen)
- **Nature du stock** : `natureStock` = `DEPOT` \| `TRANSIT` \| `AUTRES`

**APIs** :
- Liste avec filtres : `GET /vehicles?search=&status=&page=&limit=`
- Détail par ID : `GET /vehicles/:id`
- Détail par VIN (VIN 360°) : `GET /vehicles/vin/:vin`
- Mise à jour (y compris champs stock) : `PATCH /vehicles/:id` avec `dateEntreePort`, `dateEntreeParc`, `numeroBl`, `natureStock`, `regularise`

---

## 2. CRM Client

### 2.1 Vue client — Toutes les opérations liées

Pour chaque client, afficher **véhicules**, **factures**, **paiements** et **opérations transit** liés.

**API** : `GET /clients/:id`

**Réponse** : en plus des infos client (nom, email, téléphone, adresse), le backend renvoie :
- **vehicles** : liste des véhicules du client (id, vin, brand, model, year, status)
- **invoices** : factures liées aux véhicules du client (id, vehicleId, amount, status, createdAt)
- **payments** : paiements liés (id, amount, paymentType, paidAt, invoiceId, vehicleId)
- **transitOperations** : opérations transit où `client_id` = ce client (id, operationType, reference, blNumber, dateArriveePort, createdAt)

À utiliser pour une **vue client unique** (onglets ou sections : Fiche, Véhicules, Factures, Paiements, Transit).

### 2.2 Export liste des clients

**API** : `GET /clients/export?format=...`

| Paramètre | Comportement |
|-----------|--------------|
| `format=json` (défaut) | Liste complète des clients (pour génération PDF/Excel côté frontend) |
| `format=csv` | Téléchargement direct d’un fichier CSV (UTF-8 avec BOM) |

Le frontend peut :
- Pour **Excel** : appeler `format=json` et construire le fichier (xlsx) côté client, ou proposer le CSV.
- Pour **PDF** : appeler `format=json` et utiliser une librairie (ex. jsPDF) pour générer le PDF à partir des données.

**Autres APIs clients** : `GET /clients`, `POST /clients`, `PATCH /clients/:id` (CRUD classique).

---

## 3. Transit & Douane

### 3.1 Étapes transit par véhicule (existant)

- Liste des étapes d’un véhicule : `GET /vehicles/:vehicleId/transit-steps`
- CRUD étapes : `POST /vehicles/:vehicleId/transit-steps`, `PATCH /vehicles/:vehicleId/transit-steps/:id`, etc.

### 3.2 Opérations transit & douane (catégorisées)

**CRUD opérations** (maritime, véhicule, dédouanement, achats, import/export) :

| Méthode | URL | Usage |
|---------|-----|--------|
| GET | `/transit/operations` | Liste avec filtres `vehicleId`, `clientId`, `operationType`, `page`, `limit` |
| GET | `/transit/operations/:id` | Détail d’une opération |
| POST | `/transit/operations` | Création |
| PATCH | `/transit/operations/:id` | Modification |
| DELETE | `/transit/operations/:id` | Suppression |

**Types d’opération** : `MARITIME`, `VEHICULE`, `DEDOUANEMENT`, `ACHAT`, `IMPORT`, `EXPORT`.

**Champs utiles** (création / affichage) : reference, lieuExpedition, portLoading, portUnloading, dateEmbarquement, dateArriveePort, vesselName, vesselFlag, containerNumber, blNumber, declarantName, customsReference, details, vehicleId, clientId, operationType.

À utiliser pour les écrans **Transit & Douane** (liste, fiche opération, formulaire).

---

## 4. Comptabilité

### 4.1 Devis et factures

- **Devis** : `status = DEVIS` sur l’entité facture.
- **Factures** : `status = FACTURE`.
- **Types de facture** : `typeFacture` = `TEMPORAIRE` (avance) ou `COMPLETE` (soldée = véhicule régularisé).

**APIs** :
- Liste : `GET /invoices?vehicleId=&status=DEVIS|FACTURE&page=&limit=`
- Détail : `GET /invoices/:id`
- Création : `POST /invoices` (body : vehicleId, amount, status, **typeFacture**, clientId, lines, tvaRate, invoiceNumber, generatePdf)
- Mise à jour : `PATCH /invoices/:id` (status, **typeFacture**, clientId, lines, tvaRate, etc.)

**Règle métier** : lorsqu’une facture **complète** est **soldée** (paiements ≥ montant), le backend met à jour `vehicles.regularise = 1` pour le véhicule concerné. Le frontend n’a rien à faire de plus que d’enregistrer les paiements.

### 4.2 Charges, paiements, trésorerie

- **Charges** : `GET /charges` (liste globale pour la page Compta), `GET/POST/PATCH/DELETE /vehicles/:vehicleId/charges` (par véhicule).
- **Paiements** : `GET /payments?vehicleId=&invoiceId=&page=&limit=`, `POST /payments` (vehicleId, invoiceId, amount, currency, paymentType, paidAt, reference).
- **Trésorerie** : `GET /treasury/summary` (résumé par devise, alerte multi-devises).

### 4.3 Devis prestataires (prestataire / atelier)

**API** : `/devis` — devis liés à un véhicule (prestataire, montant, service, date). Lien reçu ↔ devis géré côté backend via `receipts.devis_id`.

| Méthode | URL | Usage |
|---------|-----|--------|
| GET | `/devis?vehicleId=&page=&limit=` | Liste ; chaque élément inclut `totalReceipts`, `restant`, `soldé` |
| GET | `/devis/:id` | Détail + `totalReceipts`, `restant`, `soldé` |
| GET | `/devis/:id/situation` | Situation complète : devis, total reçus, restant, liste des reçus liés |
| POST | `/devis` | Création (vehicleId, prestataireName, amount, currency, service, devisDate) |
| PATCH | `/devis/:id` | Modification |
| DELETE | `/devis/:id` | Suppression |

**Création** : `vehicleId` (obligatoire), `prestataireName`, `amount`, `currency` (défaut FCFA), `service` (texte libre), `devisDate` (date du devis). Réponse avec `vehicleVin` pour l’affichage.

Le frontend peut remplacer le store local des devis par ces appels API et utiliser `devisId` sur les reçus à la place de `erp-receipt-devis-links` en localStorage.

### 4.4 Reçus prestataires externes

**API** : `/receipts` (CRUD complet). Lien avec un devis : champ **devisId** (création / mise à jour). À la suppression d’un reçu, le lien est supprimé automatiquement.

| Méthode | URL | Usage |
|---------|-----|--------|
| GET | `/receipts?vehicleId=&devisId=&page=&limit=` | Liste ; si lié à un devis, la réponse peut inclure `devisDate`, `devisService` |
| GET | `/receipts/:id` | Détail (avec `devisId` si lié) |
| POST | `/receipts` | Création (prestataireName, amount, currency, **devisId**, documentPath, operationReference, vehicleId, notes, receivedAt) |
| PATCH | `/receipts/:id` | Modification (dont **devisId**) |
| DELETE | `/receipts/:id` | Suppression |

**Dates** : `receivedAt` accepte une chaîne ISO ; le backend convertit en format MySQL.

À utiliser pour la section **Reçus prestataires** et pour « Créer un reçu » depuis un devis (préremplir puis envoyer avec `devisId`).

### 4.5 Rapports compta et notes

**Synthèse + notes** :
- `GET /reporting/compta` → `{ summary: { invoicesByStatus, totalInvoiced, totalPayments }, notes: [...] }`
- Création d’une note : `POST /reporting/compta/notes` (content, extraData)
- Modification : `PATCH /reporting/compta/notes/:id` (content, extraData)

À utiliser pour l’écran **Rapports compta** : afficher la synthèse et permettre la saisie/édition des notes (commentaires, ajustements).

### 4.6 Infos société (logo, PDF)

**API** : `GET /company-info`, `PATCH /company-info`

Champs typiques : logoPath, raisonSociale, adresse, ifu, phone, email, siteWeb. À utiliser pour :
- Paramétrage de la société (écran dédié ou paramètres).
- Génération des PDF (factures, reçus, rapports) : le backend peut utiliser ces infos ; le frontend peut les récupérer pour préremplir les en-têtes PDF côté client si la génération est faite au front.

---

## 5. Récapitulatif des APIs par zone fonctionnelle

| Zone | Endpoints principaux |
|------|----------------------|
| **Stock** | `GET /vehicles/stock/disponible`, `GET /vehicles/stock/non-regularise` |
| **Véhicules** | `GET/POST/PATCH /vehicles`, `GET /vehicles/:id`, `GET /vehicles/vin/:vin` (champs stock inclus) |
| **CRM** | `GET/POST/PATCH /clients`, `GET /clients/:id` (avec operations), `GET /clients/export?format=json|csv` |
| **Transit** | `GET /transit/steps`, `GET /transit/vehicles` ; `GET/POST/PATCH/DELETE /transit/operations` et `/transit/operations/:id` |
| **Compta** | `GET/POST/PATCH /invoices`, `GET /charges`, `GET/POST /payments`, `GET /treasury/summary`, `GET/POST/PATCH/DELETE /devis`, `GET/POST/PATCH/DELETE /receipts` (avec **devisId**), `GET /reporting/compta`, `POST/PATCH /reporting/compta/notes`, `GET/PATCH /company-info` |

Toutes les routes sont protégées par **JWT** (header `Authorization: Bearer <token>`). Authentification : `POST /auth/login`, refresh : `POST /auth/refresh`, `GET /auth/me`.

---

## 6. Règles transverses à respecter dans l’UI

- **Clients** : toute opération impliquant un client (véhicule, facture, etc.) doit utiliser les clients enregistrés au CRM (liste/sélecteur issu de `GET /clients`).
- **Prestataires** : les reçus concernent des prestataires externes ; pas obligatoirement des clients CRM (champ libre « prestataire »).
- **Régularisation** : afficher le statut « Régularisé » / « Non régularisé » à partir de `regularise` et des sous-menus Stock disponible / Stock non régularisé.
- **PDF** : factures, reçus et rapports doivent pouvoir être générés en PDF avec logo et infos société (données depuis `GET /company-info`).

Ce résumé est aligné sur la spec fonctionnelle et l’état actuel du backend. Pour les détails complets des modèles et règles métier, se référer au document [SPEC_FONCTIONNELLE_GESTION_STOCK_CRM_TRANSIT_COMpta.md](./SPEC_FONCTIONNELLE_GESTION_STOCK_CRM_TRANSIT_COMpta.md).
