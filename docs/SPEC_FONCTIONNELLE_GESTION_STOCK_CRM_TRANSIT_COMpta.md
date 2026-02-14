# Spécification fonctionnelle — Gestion stock, CRM, Transit & Douane, Comptabilité

**Version** : 1.0  
**Date** : Février 2025  
**Contexte** : ERP Automobile & Logistique — alignement Parc auto, CRM, Transit, Compta

---

## 1. Parc automobile — Gestion du stock

### 1.1 Structure des sous-menus

Le Parc automobile doit être organisé comme une **gestion de stock** avec les sous-menus suivants :

| Sous-menu                         | Description                                                                           | Critère                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Stock disponible (régularisé)** | Véhicules dont le client a payé selon la comptabilité                                 | Régularisé = oui ; **Nature** : Dépôt, Transit, Autres |
| **Stock non régularisé**          | Véhicules en attente de paiement total ou paiement partiel en cours (selon la compta) | Régularisé = non (paiement partiel ou non enclenché)   |

### 1.2 Données obligatoires par véhicule

Pour **tous** les véhicules (liste et détail), les informations suivantes doivent être disponibles :

- Informations véhicule (VIN, marque, modèle, année, type, etc.)
- **Numéro BL** (Connaissement maritime)
- **Date d’entrée au Port**
- **Date d’entrée au Parc**
- **Nombre de jours passés sur le parc** (calculé à partir de la date d’entrée au parc)
- Statut de régularisation (lié à la compta : avance reçue, facture soldée, etc.)
- **Nature du stock** : Dépôt | Transit | Autres

### 1.3 Lien avec la comptabilité

- **Régularisé** = le client a payé selon la compta (facture complète soldée ou avance + solde conformes).
- **Non régularisé** = le client doit payer (avance, acompte) ou le paiement doit être enclenché selon la compta.
- Les statuts des véhicules (régularisé / non régularisé) doivent être cohérents avec les factures (temporaires / complètes) et les paiements.

---

## 2. CRM Client

### 2.1 Vue client

- Pour chaque client enregistré au CRM : **toutes les opérations liées** à ce client doivent ressortir dans le système (véhicules achetés/vendus, factures, paiements, transit, etc.).
- Lien dynamique : tout ce qui concerne un client (véhicules, factures, opérations) est rattaché au client du CRM.

### 2.2 Export

- **Export de la liste des clients** :
  - Format **PDF**
  - Format **Excel**
- Les exports doivent inclure les informations utiles (coordonnées, véhicules liés, etc.) selon les besoins métier.

### 2.3 Règle générale

- **Toute opération impliquant un client** doit utiliser **uniquement les clients enregistrés au CRM**. Tout est lié dynamiquement et automatiquement.
- **Exception** : les **prestataires externes** (pour les reçus, etc.) ne sont pas forcément des clients CRM ; ils peuvent être gérés à part.

---

## 3. Transit & Douane — Gestion complète

### 3.1 Périmètre

- **Gestion pro** : gestion complète des opérations de douane et de transit.
- **CRUD** avec **toutes les informations possibles** pour chaque type d’opération.

### 3.2 Catégorisation des opérations

| Catégorie               | Contenu                                                       |
| ----------------------- | ------------------------------------------------------------- |
| **Transit maritime**    | Infos navires, conteneurs (BL, ports, dates, compagnie, etc.) |
| **Transit véhicule**    | Suivi véhicule en transit (étapes, délais, etc.)              |
| **Dédouanement client** | Opérations de dédouanement liées au client                    |

### 3.3 Gestion des achats véhicule

- **Toutes les informations** nécessaires pour la **déclaration en comptabilité**.
- **Lieu d’expédition** (port, pays, etc.).
- Données exploitables pour la compta (coûts, fournisseur, etc.).

### 3.4 Imports et exports

- Gestion des **imports** et **exports** en **amont** et **aval** (processus, documents, statuts).

---

## 4. Comptabilité — Scission et règles

### 4.1 Factures et devis : scission

- **Devis** et **Factures** doivent être **clairement séparés** (menus/écrans et modèles de données).
- **Devis** : gestion dédiée (création, modification, conversion en facture si besoin).
- **Factures** : deux types (voir ci-dessous).

### 4.2 Types de factures

| Type                   | Description                             | Impact                                                                                                                   |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Facture temporaire** | Client doit payer une **avance**        | Impacte le ou les **véhicules concernés** : statut **régularisé** ou **non** selon que l’avance est enregistrée / soldée |
| **Facture complète**   | Client doit **solder** (paiement total) | Une fois soldée, véhicule(s) concerné(s) passent en **régularisé**                                                       |

### 4.3 Autres éléments compta

- **Gestion des reçus** pour les **prestataires externes** (reçus enregistrés, liés à une opération ou un véhicule si besoin).
- **Rapports de comptabilité** :
  - **Toutes les informations possibles** doivent figurer (opérations, factures, paiements, charges, etc.).
  - Possibilité de **saisie d’autres infos** (commentaires, notes, ajustements) dans le rapport.

### 4.4 Documents

- **Gestion des documents** : possibilité d’**importer tout type de document** (pas seulement un type prédéfini).
- Stockage par opération / véhicule / client selon le besoin.

### 4.5 Génération PDF (factures, reçus, rapports)

- **Factures**, **reçus** et **rapports** doivent pouvoir être **générés en PDF**.
- Chaque PDF doit inclure :
  - **Logo** de la société
  - **Informations de la société** (raison sociale, adresse, IFU, etc.)

---

## 5. Récapitulatif des règles transverses

| Règle                     | Détail                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clients = CRM**         | Toute opération impliquant un client utilise les clients enregistrés au CRM ; liaison dynamique et automatique.                              |
| **Prestataires externes** | Gestion à part (reçus, etc.) ; pas obligatoirement des clients CRM.                                                                          |
| **Régularisation**        | Définie par la compta (avance, facture temporaire, facture complète soldée) et reflétée sur le véhicule (stock régularisé / non régularisé). |
| **PDF**                   | Factures, reçus, rapports générables en PDF avec logo et infos société.                                                                      |
| **Stock parc**            | Sous-menus Stock disponible (régularisé) / Stock non régularisé ; nature Dépôt, Transit, Autres ; BL, dates Port/Parc, jours sur parc.       |

---

## 6. Backend — État actuel vs à prévoir (résumé)

- **Parc / véhicules** : VIN, statuts, dates, BL et étapes transit existent en partie ; à compléter : date entrée port, date entrée parc, nature (dépôt/transit/autres), régularisation liée à la compta.
- **CRM** : clients CRUD ; à ajouter : agrégation de toutes les opérations par client, export PDF/Excel liste clients.
- **Transit & douane** : étapes transit par véhicule ; à renforcer : catégorisation (maritime / véhicule / dédouanement), infos navires/conteneurs, achats (lieu expédition, déclaration compta), imports/exports amont-aval.
- **Compta** : factures et devis (status, lignes, TVA), charges, paiements, trésorerie ; à ajouter : factures temporaires vs complètes, impact sur régularisation véhicule, reçus prestataires, rapports avec saisie d’infos, génération PDF avec logo et infos société.
- **Documents** : upload par véhicule et type ; à prévoir : import tout type de document, lien opération/client.

Ce document sert de **référence fonctionnelle** pour les évolutions backend et frontend.

---

## Annexe A — Évolutions backend suggérées (ordre de priorité)

### A.1 Parc automobile / Stock

- **Table `vehicles`** : ajouter (migration)  
  `date_entree_port` (DATETIME), `date_entree_parc` (DATETIME), `numero_bl` (VARCHAR), `nature_stock` (ENUM 'DEPOT','TRANSIT','AUTRES'), `regularise` (TINYINT ou dérivé des paiements/factures).
- **Endpoints** :
  - `GET /vehicles/stock/disponible` (régularisé = true, filtre nature).
  - `GET /vehicles/stock/non-regularise` (régularisé = false).
  - Réponses incluant `jours_sur_parc` (calculé), BL, dates port/parc.
- **Régularisation** : mettre à jour `regularise` selon les factures (temporaire soldée / complète soldée) et paiements liés au véhicule.

### A.2 CRM Client

- **Endpoint** : `GET /clients/:id/operations` (ou enrichir `GET /clients/:id`) : véhicules, factures, paiements, opérations transit liés au client.
- **Export** : `GET /clients/export?format=pdf|excel` (génération PDF/Excel côté backend ou frontend avec données API).

### A.3 Transit & Douane

- **Tables** : renforcer `transit_steps` ou ajouter tables dédiées (transit_maritime avec infos navire/conteneurs, transit_vehicule, dedouanement, achats avec lieu_expedition).
- **CRUD** : endpoints par catégorie (maritime, véhicule, dédouanement, achats, imports/exports amont-aval) avec tous les champs nécessaires.

### A.4 Comptabilité

- **Factures** : distinguer `type_facture` (TEMPORAIRE | COMPLETE) ; lien avec régularisation véhicule (mise à jour `vehicles.regularise` à la création/paiement de facture).
- **Reçus prestataires** : table `receipts` (prestataire, montant, document, lien opération) + CRUD + génération PDF.
- **Rapports compta** : endpoint `GET /reporting/compta` (ou équivalent) avec toutes les infos + saisie d’infos additionnelles (table `report_notes` ou champs libres).
- **PDF** : tous les templates (facture, reçu, rapport) avec logo et infos société (table ou config `company_info` : logo_url, raison_sociale, adresse, IFU, etc.).

### A.5 Documents

- **Import générique** : garder types existants mais permettre type "AUTRE" ou "AUTRE" + libellé ; liaison possible à une opération, un client ou un véhicule.
- **Company info** : configuration (logo, infos société) pour la génération PDF.
