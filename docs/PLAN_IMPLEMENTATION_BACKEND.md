# Plan d'implémentation backend — ParcAuto Manager

**Plateforme** : ERP Automobile & Logistique (Bénin / Burkina Faso / Hinterland)  
**Périmètre** : 6 modules métier + 3 modules transversaux  
**Règle fondamentale** : transitions de statuts strictement conditionnées (métier + comptabilité)

---

## Vue d'ensemble des phases

| Phase | Périmètre | Priorité | Durée indicative |
|-------|-----------|----------|-------------------|
| **Phase 0** | Auth renforcée, RBAC, Dashboard | P0 | 2–3 semaines |
| **Phase 1** | Supply Chain complet (Achats → Stocks) | P0 | 3–4 semaines |
| **Phase 2** | Comptabilité (Charges, Factures, Reçus, Devis, Trésorerie) | P0 | 3–4 semaines |
| **Phase 3** | CRM Clients, Fiche véhicule 360°, Export | P1 | 2 semaines |
| **Phase 4** | Transit international (workflow 7 étapes, documents, alertes) | P1 | 3 semaines |
| **Phase 5** | Pro Forma, MeCeF, Rapports, Alertes automatiques | P1 | 2–3 semaines |
| **Phase 6** | Paramètres système, 2FA, Audit log, Notifications | P2 | 2 semaines |

---

## Phase 0 — Authentification & Tableau de bord

### 0.1 Authentification & sessions (backend)

| Tâche | Description | Endpoints / technique |
|-------|-------------|------------------------|
| Connexion sécurisée | Email + mot de passe, JWT access + refresh | `POST /auth/login`, `POST /auth/refresh` (existant) |
| Hachage bcrypt | Cost factor 12 | `bcrypt.hash(password, 12)` à la création / changement MDP |
| 2FA optionnel | TOTP (Google Authenticator) ou SMS | `POST /auth/2fa/setup`, `POST /auth/2fa/verify`, `POST /auth/login` avec code 2FA |
| Déconnexion inactivité | Session expire après 30 min | Refresh token + `expiresIn` 30 min ou middleware vérifiant `lastActivity` |
| Rôles et permissions | RBAC par module | Table `permissions` / `role_permissions`, middleware `authorize(module, action)` |

**Modèle de données à prévoir**  
- `users` : ajouter `two_fa_secret`, `two_fa_enabled`, `last_activity_at`.  
- `roles` (existant ou à clarifier), `permissions` (ex. `SUPPLY_CHAIN_READ`, `INVOICES_WRITE`), `role_permissions`.

**Livrables**  
- Login / refresh / logout conformes au CDC.  
- Middleware RBAC utilisé sur toutes les routes métier.  
- (P2) 2FA TOTP activable par l’admin.

---

### 0.2 Tableau de bord

| Indicateur | Source backend | Endpoint / logique |
|------------|----------------|--------------------|
| Stocks Disponible | `COUNT(vehicles WHERE status = 'DISPONIBLE')` | Déjà exposé dans `GET /dashboard/stats` |
| Stocks Non Régulier | `COUNT(vehicles WHERE status = 'EN_VENTE')` | Idem |
| Stocks Régulier | `COUNT(vehicles WHERE status = 'VENDU')` | Idem |
| Clients actifs | Clients avec au moins 1 facture ou 1 véhicule acheté | Requête agrégée ou champ dédié |
| CA Semaine / Mois | Somme des reçus (vente) sur 7 j / 30 j | Déjà exposé (`caSemaine`, `caMois`) |
| Véhicules en maintenance | `COUNT(vehicles WHERE status = 'EN_MAINTENANCE')` | Déjà exposé |
| Véhicules en transit | `COUNT(vehicles WHERE status = 'EN_TRANSIT')` + transit steps | Déjà exposé |
| Alertes actives | Impayés, échéances douane, maintenances en retard | Requêtes dédiées (factures impayées, dates admission temporaire, devis en retard) |

**Livrables**  
- `GET /dashboard/stats` complet et documenté.  
- (P1) `GET /dashboard/alertes` pour impayés, échéances, transit, maintenance.

---

## Phase 1 — Supply Chain (Module 1)

### 1.1 Gestion des achats

| Fonctionnalité | Règle métier | Backend |
|----------------|--------------|--------|
| Création achat | Fournisseur, véhicules, prix FCFA, devise, taux | `POST /purchases` (existant), body avec `vehicules[]` |
| Statut EN_COURS | Défaut à la création | Déjà appliqué |
| Validation arrivée | Admin valide → statut ARRIVÉ, véhicules → DISPONIBLE | `PATCH /purchases/:id/arrive` (existant, véhicules en DISPONIBLE) |
| Modification / suppression | Uniquement si statut = EN_COURS | `PUT /purchases/:id`, `DELETE /purchases/:id` (existant) |
| Fiche achat | Récap fournisseur, véhicules, coût, date arrivée | `GET /purchases/:id` (existant) |

**À compléter**  
- Motif obligatoire en body pour `DELETE` (champ `motif_suppression` ou `reason`).  
- Documents d’achat : upload Connaissement, facture fournisseur (liés à l’achat ou au véhicule).

---

### 1.2 Fiche véhicule — données maîtres

| Champ | Type / contrainte | Table / champ backend |
|-------|--------------------|------------------------|
| VIN (châssis) | Texte unique | `vehicles.vin` |
| Marque / Modèle / Année | Texte / liste | `vehicles.brand`, `model`, `year` |
| Couleur / Carrosserie | Texte | `vehicles.color` (+ carrosserie si besoin) |
| Kilométrage à l’arrivée | Nombre | `vehicles.mileage` |
| Pays d’origine | Liste (Europe, USA, Asie…) | À ajouter : `vehicles.country_origin` ou enum |
| Prix d’achat (FCFA) | Montant | Via `purchases` (amount_fcfa, conversion) |
| Prix de vente (FCFA) | Montant | `vehicles.price_sale` |
| Documents joints | Connaissement, titre, carte grise | `documents` (entity_type = vehicle) |
| Photos | Min 4 (avant/arrière/profil/intérieur) | `documents` avec type ou table dédiée |
| Statut | Enum (disponible, en_vente, en_maintenance, vendu, en_transit) | `vehicles.status` |

**Livrables**  
- Migration : ajout `country_origin` (ou équivalent) sur `vehicles`.  
- `GET /vehicles/:id` et `GET /vehicles/vin/:vin` renvoyant tous ces champs + documents.  
- Contrainte ou validation : au moins 4 photos recommandées (optionnel en backend, contrôlable en front).

---

### 1.3 Vue globale du parc

| Besoin | Implémentation backend |
|--------|------------------------|
| Liste tous véhicules, tous statuts | `GET /vehicles` avec pagination (existant) |
| Filtres : marque, modèle, châssis, statut, date arrivée, fourchette prix, fournisseur, pays origine | Query params sur `GET /vehicles` (étendre les filtres existants) |
| Recherche rapide VIN / immatriculation | Paramètre `search` ou `vin` (existant) |
| Export Excel / PDF | `GET /vehicles/export?format=xlsx|pdf` + query params de filtre (nouveau) |
| Indicateurs : valeur totale stock FCFA, délai moyen rotation | `GET /dashboard/stats` ou `GET /stock/indicators` (agrégats) |

**Livrables**  
- Filtres avancés sur `GET /vehicles` (et/ou `GET /stock`).  
- Endpoint d’export (Excel via lib, PDF via template).  
- Indicateurs “valeur stock”, “délai moyen rotation” exposés en API.

---

### 1.4 Stocks Disponible (DISPONIBLE)

| Action | Transition / règle | Backend |
|--------|---------------------|--------|
| Voir fiche détaillée | — | `GET /vehicles/:id` |
| Ajouter / modifier prix de vente | Mise à jour `price_sale` | `PUT /vehicles/:id` ou `PATCH /vehicles/:id` (champ `price_sale`) |
| Envoyer vers atelier | DISPONIBLE → EN_MAINTENANCE | `PATCH /vehicles/:id/status` (existant) |
| Débuter la vente | DISPONIBLE → EN_VENTE | `PATCH /vehicles/:id/status` (existant) |

Aucune évolution majeure si les transitions sont déjà gérées.

---

### 1.5 Stocks Non Régulier (EN_VENTE)

| Règle | Implémentation |
|-------|----------------|
| Historique des paiements (acomptes, soldes, dates) | `GET /invoices/:id` avec `receipts` (existant) ou timeline véhicule |
| Clôture vente active uniquement si solde = 0 | Déjà implémenté : transition EN_VENTE → VENDU refusée si somme reçus < montant facture |
| Bouton clôture désactivé si paiement partiel | Frontend : désactiver si `remaining_amount > 0` (donné par API facture) |

Backend déjà aligné ; documenter le contrat (solde, remaining_amount) pour le front.

---

### 1.6 Stocks Régulier (VENDU)

Consultation lecture seule, historique paiements, archivage après N mois :  
- Lecture seule = pas de `PUT`/`PATCH` sur véhicule VENDU (ou rôle limité).  
- Archivage = statut dédié ou flag `archived_at` + filtre par défaut “non archivés”.

**Livrables**  
- Règle : pas de modification véhicule en VENDU (sauf annulation métier explicite).  
- (P1) Champ `archived_at` ou statut ARCHIVE + paramètre `archived` dans les listes.

---

### 1.7 Garage / Maintenance (EN_MAINTENANCE)

| Action | Règle | Backend |
|--------|-------|--------|
| Voir fiche véhicule | — | `GET /vehicles/:id` |
| Historique devis | Liste devis du véhicule | `GET /devis?vehicleId=:id` ou inclus dans fiche véhicule |
| Créer devis maintenance | Lié au véhicule EN_MAINTENANCE | `POST /devis` (existant) |
| Clôturer maintenance | Uniquement si reçu lié au devis émis (devis clôturé) | Déjà implémenté : EN_MAINTENANCE → DISPONIBLE refusé sans devis TERMINE |

**Livrables**  
- S’assurer que la création de devis exige `vehicle.status = EN_MAINTENANCE`.  
- Conserver la règle “clôture maintenance = devis clôturé (reçu émis)”.

---

## Phase 2 — Comptabilité (Module 2)

### 2.1 Charges

| Fonctionnalité | Backend |
|----------------|--------|
| Création charge | Libellé, catégorie, montant FCFA, date, pièce jointe | `POST /charges` (existant ou à créer) |
| Modification / suppression | Avec motif pour traçabilité | `PUT /charges/:id`, `DELETE /charges/:id` + champ `motif` |
| Catégories paramétrables | Loyer, carburant, salaires, douane, maintenance… | Table `charge_categories` ou config, liste exposée en API |
| Filtres période, catégorie, montant | Query params sur `GET /charges` |
| Export Excel / PDF | `GET /charges/export?format=xlsx|pdf` |

**Livrables**  
- CRUD charges + jointure catégorie.  
- Table ou config catégories, endpoint `GET /settings/charge-categories`.  
- Audit : enregistrer `motif` et `deleted_by` / `updated_by` sur suppression / modification.

---

### 2.2 Devis (maintenance)

| Règle | Backend |
|-------|--------|
| Création liée véhicule EN_MAINTENANCE | `POST /devis` avec `vehicleId` ; vérifier statut véhicule |
| Voir / modifier si non clôturé | `GET /devis/:id`, `PUT /devis/:id` (bloquer si statut TERMINE) |
| Supprimer avec motif | `DELETE /devis/:id` + body `motif`, trace audit |
| Émettre reçu depuis devis | `POST /receipts` avec `invoice_id` = null et `quote_id` = id devis (ou lien devis–reçu dédié) |
| Clôture via reçu | À l’émission du reçu lié au devis : mettre devis en TERMINE, permettre clôture maintenance |

**Modèle**  
- Reçus : soit `invoice_id` nullable + `workshop_quote_id`, soit table `workshop_quote_receipts`.  
- Déjà partiellement en place (devis, reçus) ; à aligner avec “reçu devis → clôture devis”.

**Livrables**  
- Lien reçu ↔ devis, mise à jour automatique du statut devis à TERMINE.  
- Endpoint ou logique “émettre reçu depuis devis” documentée.

---

### 2.3 Factures

| Fonctionnalité | Backend |
|----------------|--------|
| Création liée véhicule EN_VENTE + client | `POST /invoices` (existant), vérifier `vehicle.status` et unicité facture par véhicule si besoin |
| Partielle (acompte) ou totale | Champ `amount`, `total_amount` ; éventuellement type “ACOMPTE” / “TOTALE” |
| Numérotation auto (FAV-2026-0001) | Config dans paramètres, séquence en BDD ou fichier |
| PDF après création | Génération PDF côté backend, retour URL ou stream |
| Modification tant que vente non clôturée | `PUT /invoices/:id` si véhicule encore EN_VENTE |
| Suppression avec motif | `DELETE /invoices/:id` + motif, audit |
| Historique factures véhicule / client | `GET /vehicles/:id/timeline` ou `GET /invoices?vehicleId=`, `?clientId=` |

**Livrables**  
- Numérotation paramétrable (format + compteur).  
- Génération PDF facture.  
- Règles modification / suppression + audit.

---

### 2.4 Reçus

| Règle | Backend |
|-------|--------|
| Reçu lié à facture → mise à jour solde | Déjà en place (somme reçus, statut facture, passage véhicule en VENDU si solde = 0) |
| Reçu lié à devis → clôture devis | À implémenter (voir 2.2) |
| Voir, modifier, PDF, supprimer avec motif | CRUD reçus (existant) + champ motif sur suppression + PDF |

**Livrables**  
- Endpoint PDF reçu.  
- Suppression avec motif et traçabilité.

---

### 2.5 Trésorerie

| Indicateur | Calcul | Backend |
|------------|--------|--------|
| Total recettes période | Somme reçus (vente) sur période | Agrégat sur `receipts` (filtrer par type si besoin) |
| Total charges période | Somme charges sur période | Agrégat sur `charges` |
| Solde net | Recettes − Charges | Calculé dans `GET /treasury/summary` ou équivalent |
| Encours clients | Factures partielles non soldées | Somme `remaining_amount` par client ou global |
| Valeur stock | Prix d’achat total véhicules en stock (DISPONIBLE, EN_VENTE, etc.) | Agrégat `vehicles` + `purchases` |

**Livrables**  
- `GET /treasury/summary` ou extension du dashboard avec ces indicateurs.  
- Période en query (date début, date fin).

---

### 2.6 Factures Pro Forma

| Fonctionnalité | Backend |
|----------------|--------|
| Création / gestion | CRUD proformas (existant), lien avec transit si besoin |
| Lien MeCeF | Appel API MeCeF (vérification conformité) — paramétrage URL + clé | Service dédié `services/mecef.js`, appel optionnel à la génération |
| PDF conforme douane | Template PDF Pro Forma Bénin/Burkina |
| Numérotation PF-2026-0001 | Paramètres système, séquence dédiée |

**Livrables**  
- Numérotation Pro Forma distincte.  
- (P1) Intégration MeCeF (config + appel).  
- PDF Pro Forma conforme.

---

### 2.7 Rapports

| Besoin | Backend |
|--------|--------|
| Rapport hebdo auto (lundi) | Job planifié (cron ou node-cron) : génère rapport (recettes, ventes, achats, charges, trésorerie, maintenance, alertes transit) |
| Rapports par période / catégorie | `GET /reporting?from=&to=&type=` (existant à étendre) |
| Liste des rapports générés | Table `generated_reports` (id, type, period_start, period_end, file_path, created_at) |
| Consulter, télécharger PDF, archiver | `GET /reporting/:id`, `GET /reporting/:id/download`, `PATCH /reporting/:id` (archived = true) |
| Rapport stock valorisé à date T | Agrégat véhicules (prix achat ou vente) à la date T (snapshot ou recalcul selon règles) |

**Livrables**  
- Modèle `generated_reports` + job hebdo.  
- Endpoints liste / téléchargement / archivage.  
- Rapport stock valorisé (endpoint + logique de date).

---

## Phase 3 — CRM Clients (Module 4)

### 3.1 Fiche client

Champs : nom/raison sociale, type (Particulier/Pro), téléphone(s), email, adresse, pays, NIF/RCCM.  
Backend : étendre `clients` si besoin (type, nif, rccm), `GET /clients/:id`, `PUT /clients/:id`.

### 3.2 Historique client (360°)

| Donnée | Source |
|--------|--------|
| Véhicules achetés + statut + prix | Jointure factures / véhicules / reçus |
| Historique paiements (factures + reçus) | `GET /clients/:id/payments` ou inclus dans fiche |
| Opérations transit liées | Factures / véhicules du client → dossiers transit |
| Notes internes | Table `client_notes` ou champ sur `clients` |
| Export PDF fiche client | Génération PDF à partir des données agrégées |

**Livrables**  
- `GET /clients/:id` enrichi (achats, paiements, transit, notes).  
- `GET /clients/:id/export?format=pdf`.

---

## Phase 4 — Transit international (Module 3)

### 4.1 Workflow 7 étapes

Statuts : ARRIVEE_PORT → ADMISSION_TEMPORAIRE → DECLARATION_DOUANE → MAINLEVE → SCELLES_POSES → EN_ACHEMINEMENT → LIVRE.

| Backend | Détail |
|---------|--------|
| Tables | `transit_steps` (déjà), `transit_operations` (déjà) ; s’assurer que les étapes correspondent à la config (TRANSIT_STEPS) |
| Entrée transit | Véhicule VENDU (ou EN_VENTE selon cas) → création dossier transit (lien véhicule ↔ opération / étapes) |
| Passage d’étape | `PATCH /transit/steps/:id` ou “étape suivante” avec contrôle de l’ordre |
| Documents par étape | Table `transit_documents` (transit_step_id, type_document, file_path) ou `documents` avec entity_type = transit_step |

**Livrables**  
- Machine à étapes stricte (ordre imposé).  
- Liaison véhicule → transit (une opération ou un “dossier” transit par véhicule/vente).

---

### 4.2 Documents transit

Connaissement, Facture Pro Forma, DTI, Certificat immatriculation, Quittance douane, PV Scellés, PV Livraison.  
Stockage : `documents` (entity_type = transit_step ou transit_operation) avec `document_type` (enum).  
Livrable : schéma + upload par étape + liste des types requis par étape (config ou table).

---

### 4.3 Alertes transit

| Alerte | Déclencheur | Backend |
|--------|-------------|--------|
| J-7 admission temporaire | Date fin admission temporaire − 7 jours | Requête ou job quotidien, création alerte / notification |
| Véhicule bloqué > N jours | Dernière mise à jour étape > N jours | Idem |
| Document manquant / expiré | Contrôle des types requis par étape | Règles + notification |

**Livrables**  
- Table ou entité `alertes` (type, entity_id, message, due_date, lu).  
- Job ou requête “alertes actives” exposée au dashboard / module transit.

---

## Phase 5 — Utilisateurs & RBAC (Module 5)

| Rôle | Modules (lecture + écriture sauf mention) | Backend |
|------|------------------------------------------|--------|
| Admin | Tous (lecture + écriture + suppression + config) | Rôle SUPER_ADMIN / ADMIN |
| Commercial | CRM, Stocks, Ventes, Factures (pas de suppression) | Rôle COMMERCIAL, permissions sans DELETE sur factures |
| Comptable | Comptabilité, Trésorerie, Rapports | Rôle COMPTABLE |
| Responsable Stock | Supply Chain, Vue parc, Achats | Rôle RESPONSABLE_STOCK |
| Transitaire | Transit, Documents, Alertes | Rôle AGENT_TRANSIT |
| Technicien | Garage, Devis | Rôle dédié ou RESPONSABLE_STOCK partiel |

**Livrables**  
- Table `permissions` (module, action), `role_permissions`.  
- Middleware `authorize(module, action)` sur chaque route.  
- CRUD utilisateurs + attribution rôle (existant à compléter).  
- Journal d’audit : table `audit_log` (user_id, action, entity_type, entity_id, payload, ip, created_at).

---

## Phase 6 — Paramètres système (Module 6)

| Paramètre | Backend |
|-----------|--------|
| Devises et taux de change | Table `currencies`, `exchange_rates` (date, devise, taux vs FCFA) ; API config + mise à jour |
| Numérotation documents | Table `document_sequences` (type: facture, reçu, devis, proforma, prefix, compteur, année) |
| Taxes / TVA | Table `tax_rates` ou config (taux, libellé) |
| MeCeF | Config (URL, clé API) en table `settings` ou .env |
| Tableau de bord (indicateurs, ordre, seuils) | Table `dashboard_config` (company_id, indicateurs affichés, seuils alerte) |
| Catégories de charges | Déjà prévues en Phase 2 |
| Notifications (email/SMS), seuils alerte transit | Table `notification_settings`, `alert_thresholds` |

**Livrables**  
- Endpoints `GET/PUT /settings/*` ou `/company-info` étendu.  
- Séquences de numérotation centralisées et paramétrables.

---

## Synthèse des priorités backend

| Priorité | Éléments |
|----------|----------|
| **P0** | Auth (JWT, refresh, bcrypt 12), RBAC de base, Dashboard complet, Supply Chain (achats, véhicules, statuts, arrivée), Comptabilité (charges, factures, reçus, devis, trésorerie), règles de clôture vente et maintenance |
| **P1** | CRM 360°, Export Excel/PDF parc et charges, Pro Forma + numérotation, Transit 7 étapes + documents + alertes, Rapports hebdo + stock valorisé, Alertes dashboard |
| **P2** | 2FA TOTP, Déconnexion 30 min, Audit log complet, MeCeF, Paramètres dashboard et notifications, Archivage véhicules vendus |

---

## Ordre de mise en œuvre recommandé

1. **RBAC et permissions** (pour sécuriser tout le reste).  
2. **Données maîtres véhicule** (pays origine, documents, photos) et fiche véhicule complète.  
3. **Charges** (CRUD, catégories, motif suppression).  
4. **Lien reçu ↔ devis** et clôture automatique devis.  
5. **Numérotation** (factures, reçus, devis, pro forma).  
6. **PDF** (facture, reçu, pro forma, fiche client).  
7. **Trésorerie** (synthèse période, encours, valeur stock).  
8. **Transit** (workflow strict, documents par étape, alertes J-7 et blocage).  
9. **Rapports** (génération, stockage, téléchargement).  
10. **Paramètres** (devises, séquences, seuils).  
11. **2FA et audit log** en dernier.

Ce document peut servir de référence pour les sprints et le suivi d’avancement (à cocher au fur et à mesure).
