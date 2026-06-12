# Déploiement — Vercel + Neon (PostgreSQL)

Ce backend a été migré de **MySQL** vers **PostgreSQL (Neon)** et adapté pour
tourner en **serverless sur Vercel**.

## Ce qui a changé par rapport à la version MySQL

| Élément | Avant (MySQL) | Après (Postgres/Vercel) |
|---|---|---|
| Base de données | MySQL (XAMPP) | PostgreSQL (Neon) |
| Provider Prisma | `mysql` | `postgresql` (+ `directUrl`) |
| Requêtes SQL brutes | `mysql2` (`pool.execute`) | 100 % Prisma (agnostique DB) |
| Driver `mysql2` | requis | **supprimé** |
| Serveur HTTP | `app.listen` permanent | `app.listen` seulement hors Vercel ; `api/index.js` sert de fonction serverless |
| Stockage fichiers | disque local | Cloudflare R2 / S3 (`STORAGE_DRIVER=s3`) |
| Étapes transit (`step_name`) | enum | `VARCHAR(50)` (l'app utilise des valeurs hors de l'ancien enum) |

> Les fichiers `scripts/*.sql` sont l'ancien DDL **MySQL** : ils ne sont plus
> utilisés (la structure est gérée par les migrations Prisma Postgres dans
> `prisma/migrations/`). Conservés pour référence historique uniquement.

## 1. Créer la base Neon

1. Sur [neon.tech](https://neon.tech), créer un projet → une base.
2. Récupérer **deux** chaînes de connexion :
   - **Pooled** (host avec `-pooler`) → `DATABASE_URL` (runtime serverless).
   - **Direct** (host sans `-pooler`) → `DIRECT_URL` (migrations).
3. Ajouter `?sslmode=require` à la fin des deux URLs.

## 2. Appliquer le schéma à Neon

Depuis la machine de dev, avec `DATABASE_URL`/`DIRECT_URL` pointant sur Neon :

```bash
npm install
npx prisma migrate deploy   # applique prisma/migrations/0_init sur Neon
```

> ⚠️ Migration de données : ce projet repart d'un schéma **vide** sur Postgres.
> Les anciennes données MySQL ne sont pas transférées automatiquement. Si tu
> dois les reprendre, exporte-les côté MySQL et réimporte-les (les types et la
> casse des identifiants diffèrent — prévoir un script d'ETL).

Seed minimal (société + admin) : adapter `scripts/seed_*.sql` en SQL Postgres,
ou créer un `prisma/seed.js` utilisant le client Prisma.

## 3. Configurer le stockage (Cloudflare R2)

1. Créer un bucket R2 + un token API (Access Key / Secret).
2. Renseigner les variables `S3_*` (voir `.env.example`), avec
   `STORAGE_DRIVER=s3` et `S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com`.

## 4. Déployer sur Vercel

1. Importer le repo dans Vercel (**Root Directory** = ce dossier backend).
2. Variables d'environnement à définir (Project Settings → Environment Variables) :
   - `DATABASE_URL`, `DIRECT_URL`
   - `JWT_SECRET`, `JWT_REFRESH_SECRET`
   - `CORS_ORIGIN` (URL du frontend), `FRONTEND_URL`
   - `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`,
     `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`
   - `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` (ou `BREVO_API_KEY`)
3. Build : `npm install` déclenche `postinstall` → `prisma generate`.
   `vercel.json` route toutes les requêtes vers `api/index.js`.
4. `prisma migrate deploy` doit être lancé **séparément** (étape 2 ou via un job
   CI), pas pendant le build Vercel.

## 5. Vérifications post-déploiement

- `GET https://<deploiement>.vercel.app/health` → `{ "status": "ok" }`
- `POST /auth/login` puis un endpoint protégé (`GET /dashboard/stats`).
- Upload d'un fichier (`POST /uploads`) puis lecture (`GET /uploads/:id/raw`)
  pour valider R2.

## Notes serverless

- `src/lib/prisma.js` réutilise une instance globale → limite le nombre de
  connexions ouvertes par les fonctions serverless. L'URL **pooled** de Neon est
  importante pour éviter de saturer les connexions.
- `maxDuration` est fixé à 30 s dans `vercel.json` (génération PDF, etc.).
- Les uploads passent par `multer.memoryStorage` (pas d'écriture disque) puis
  sont poussés vers R2 : compatible avec le filesystem en lecture seule de Vercel.
```
