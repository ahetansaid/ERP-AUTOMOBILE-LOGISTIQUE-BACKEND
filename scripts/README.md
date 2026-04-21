# Scripts SQL - ParcAuto Manager

## Creation complete de la base (recommandé)

Un seul fichier crée la base `parcauto` et toutes les tables :

```bash
mysql -u root -p < scripts/create_database_complete.sql
```

Sous Windows (XAMPP) :

```bash
cd C:\xampp\mysql\bin
mysql -u root -p < C:\xampp\htdocs\ERP-AUTOMOBILE-LOGISTIQUE-BACKEND\scripts\create_database_complete.sql
```

Ou depuis le client MySQL :

```sql
SOURCE C:/xampp/htdocs/ERP-AUTOMOBILE-LOGISTIQUE-BACKEND/scripts/create_database_complete.sql;
```

Un compte admin a été ajouté avec le hash bcrypt généré :
Email : admin@parcauto.local
Mot de passe : admin123
Rôle : ADMIN

Le script :

- Crée la base `parcauto` si elle n'existe pas
- Crée toutes les tables : companies, users, suppliers, clients, vehicles, purchases, purchase_vehicles, invoices, receipts, charges, workshop_quotes, proformas, transit_steps, exchange_rates, generated_reports, notifications
- Insère les taux de change par défaut (USD, EUR)

## Créer un utilisateur admin

Après la création de la base, générer un hash bcrypt puis insérer l'utilisateur :

```bash
cd C:\xampp\htdocs\ERP-AUTOMOBILE-LOGISTIQUE-BACKEND
node -e "require('bcrypt').hash('admin123', 12).then(h => console.log(h))"
```

Copier le hash affiché, puis en SQL :

```sql
USE parcauto;
INSERT INTO users (email, password, first_name, last_name, role, is_active)
VALUES ('admin@parcauto.local', 'COLLER_LE_HASH_ICI', 'Admin', 'ParcAuto', 'ADMIN', 1);
```

## Migrations incrémentales (optionnel)

Le dossier `migrations/` contient des scripts séparés si vous préférez appliquer les changements un par un. Pour une nouvelle installation, `create_database_complete.sql` suffit.

- **add_vehicles_purchase_price_fcfa.sql** : ajoute la colonne `purchase_price_fcfa` à la table `vehicles` (équivalent FCFA du prix d'achat). À exécuter si la base existait avant cette évolution. En cas d'erreur « Duplicate column », la colonne est déjà présente.
- **add_purchases_arrival_date.sql** : ajoute `arrival_date` à `purchases`.
- **add_workshop_quotes_closed_at.sql** : ajoute `closed_at` à `workshop_quotes` (date de clôture devis atelier).
- **add_invoices_unique_vehicle.sql** : contrainte UNIQUE sur `invoices(vehicle_id)` — 1 véhicule = 1 facture (à exécuter après suppression des doublons éventuels).
- **add_vehicles_transport_fees.sql** : colonne `transport_fees` sur `vehicles`.
- **create_transactions_tresorerie.sql** : table `transactions_tresorerie` (flux trésorerie).’