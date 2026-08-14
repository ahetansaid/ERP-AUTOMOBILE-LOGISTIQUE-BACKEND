/**
 * Service stockage fichiers — ParcAuto Manager
 *
 * Drivers supportés :
 *   - `local` (défaut) : filesystem. Pour le dev. NE PAS utiliser sur Vercel
 *     (filesystem éphémère/lecture seule en serverless).
 *   - `db`             : contenu binaire dans PostgreSQL. Aucun service tiers
 *     à ouvrir, aucune clé à gérer — au prix d'un plafond de taille. Pour des
 *     pièces justificatives (quelques centaines de PDF), c'est suffisant et
 *     c'est un compte de moins à administrer.
 *   - `s3`             : stockage objet S3-compatible (Cloudflare R2, AWS S3,
 *     MinIO...). Le seul qui tienne pour des photos de véhicules.
 *
 * Sélection via STORAGE_DRIVER=local|db|s3.
 *
 * CE QUE LE PILOTE `db` COÛTE, ET POURQUOI IL EST PLAFONNÉ
 *
 * Le contenu transite entièrement par la mémoire de la fonction serverless :
 * il n'y a pas de flux paresseux depuis une colonne bytea. Un fichier de
 * 25 Mo — la limite d'envoi — occuperait donc 25 Mo de mémoire à l'écriture
 * comme à la lecture, et la réponse dépasserait ce que la plateforme accepte.
 *
 * D'où un plafond propre à ce pilote, refusé À L'ENTRÉE avec un message qui
 * nomme la solution. Un refus explicite vaut mieux qu'un dépôt accepté puis
 * introuvable.
 *
 * Les sauvegardes et les branches Neon copient ce contenu à chaque fois : le
 * jour où le parc se photographie, il faut passer en `s3`. La bascule ne
 * change qu'une variable — les fichiers déjà déposés, eux, sont à migrer.
 *
 * Clé de stockage : {kind}/{YYYY}/{MM}/{uuid}.{ext}
 * Les fichiers sont servis via GET /uploads/:id (endpoint protégé).
 *
 * Variables d'env pour le driver s3 (R2) :
 *   S3_ENDPOINT          ex: https://<accountid>.r2.cloudflarestorage.com
 *   S3_REGION            ex: auto (R2) | eu-west-3 (AWS)
 *   S3_BUCKET            nom du bucket
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_FORCE_PATH_STYLE  "true" pour R2/MinIO (défaut true)
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { Readable } = require('stream');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const STORAGE_ROOT =
  process.env.STORAGE_ROOT ||
  path.resolve(__dirname, '..', '..', 'storage', 'uploads');

function uid() {
  return crypto.randomBytes(12).toString('hex');
}

function buildStorageKey(kind, originalName) {
  const now = new Date();
  const ext = (path.extname(originalName || '') || '').toLowerCase().slice(0, 10);
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${(kind || 'OTHER').toLowerCase()}/${yyyy}/${mm}/${uid()}${ext}`;
}

// ---------------------------------------------------------------------------
// Driver local (filesystem)
// ---------------------------------------------------------------------------

async function putObjectLocal(storageKey, buffer) {
  const abs = path.join(STORAGE_ROOT, storageKey);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
  return abs;
}

function streamObjectLocal(storageKey) {
  const abs = path.join(STORAGE_ROOT, storageKey);
  if (!fs.existsSync(abs)) {
    throw new Error(`Fichier introuvable : ${storageKey}`);
  }
  return fs.createReadStream(abs);
}

async function deleteObjectLocal(storageKey) {
  const abs = path.join(STORAGE_ROOT, storageKey);
  if (fs.existsSync(abs)) {
    await fsp.unlink(abs);
  }
}

// ---------------------------------------------------------------------------
// Driver db (contenu binaire dans PostgreSQL)
// ---------------------------------------------------------------------------

/**
 * Plafond du pilote `db`, en octets.
 *
 * Huit mégaoctets : au-delà, le passage par la mémoire de la fonction et la
 * taille de la réponse HTTP deviennent le vrai problème, bien avant la base.
 * Réglable, mais l'augmenter sans passer à `s3` revient à déplacer la panne.
 */
const DB_MAX_BYTES = Number(process.env.STORAGE_DB_MAX_BYTES || 8 * 1024 * 1024);

// Chargé paresseusement : storage.js est requis par des scripts qui n'ouvrent
// aucune connexion, et prisma.js tire tout le client avec lui.
function db() {
  // eslint-disable-next-line global-require
  return require('./prisma').prisma;
}

function ctxCompanyId() {
  // eslint-disable-next-line global-require
  const { getContext } = require('./context');
  const cid = getContext()?.companyId;
  if (cid == null) {
    throw new Error(
      '[storage] écriture de fichier hors contexte société : le pilote `db` ' +
        'range le contenu par société, il lui faut savoir laquelle.'
    );
  }
  return cid;
}

async function putObjectDb(storageKey, buffer, contentType) {
  if (buffer.length > DB_MAX_BYTES) {
    const mo = (n) => `${(n / 1024 / 1024).toFixed(1)} Mo`;
    throw new Error(
      `Fichier trop volumineux pour le stockage en base : ${mo(buffer.length)} ` +
        `pour un plafond de ${mo(DB_MAX_BYTES)}. Pour des fichiers plus lourds ` +
        '— photos de véhicules notamment — passez STORAGE_DRIVER=s3.'
    );
  }

  await db().fileBlob.create({
    data: {
      storageKey,
      companyId: ctxCompanyId(),
      contentType: contentType || 'application/octet-stream',
      sizeBytes: buffer.length,
      data: buffer,
    },
  });
  return storageKey;
}

async function streamObjectDb(storageKey) {
  // Le filtre société de l'extension Prisma s'applique : une clé appartenant à
  // une autre entreprise n'est tout simplement pas trouvée.
  const blob = await db().fileBlob.findFirst({ where: { storageKey } });
  if (!blob) throw new Error(`Fichier introuvable : ${storageKey}`);
  return Readable.from(Buffer.from(blob.data));
}

async function deleteObjectDb(storageKey) {
  // deleteMany plutôt que delete : une clé déjà absente n'est pas une erreur,
  // et la suppression d'une pièce ne doit pas échouer pour ça.
  await db().fileBlob.deleteMany({ where: { storageKey } });
}

// ---------------------------------------------------------------------------
// Driver S3 / R2 (chargé paresseusement pour ne pas exiger le SDK en dev)
// ---------------------------------------------------------------------------

let _s3Client = null;
let _S3 = null;

function getS3() {
  if (_s3Client) return { client: _s3Client, S3: _S3 };
  // require paresseux : @aws-sdk/client-s3 n'est nécessaire que si DRIVER=s3
  // eslint-disable-next-line global-require
  const S3 = require('@aws-sdk/client-s3');
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const region = process.env.S3_REGION || 'auto';
  const forcePathStyle =
    (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false';

  _s3Client = new S3.S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  _S3 = S3;
  return { client: _s3Client, S3 };
}

function s3Bucket() {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error('S3_BUCKET non défini (driver de stockage s3)');
  return b;
}

async function putObjectS3(storageKey, buffer, contentType) {
  const { client, S3 } = getS3();
  await client.send(
    new S3.PutObjectCommand({
      Bucket: s3Bucket(),
      Key: storageKey,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  return storageKey;
}

async function streamObjectS3(storageKey) {
  const { client, S3 } = getS3();
  const res = await client.send(
    new S3.GetObjectCommand({ Bucket: s3Bucket(), Key: storageKey })
  );
  // En runtime Node, Body est un stream.Readable directement pipe-able.
  return res.Body;
}

async function deleteObjectS3(storageKey) {
  const { client, S3 } = getS3();
  await client.send(
    new S3.DeleteObjectCommand({ Bucket: s3Bucket(), Key: storageKey })
  );
}

// ---------------------------------------------------------------------------
// API publique (uniforme quel que soit le driver)
// ---------------------------------------------------------------------------

/**
 * Persiste un buffer en stockage. Retourne la `storageKey`.
 * @param {{kind:string, originalName:string, buffer:Buffer, contentType?:string}} args
 */
async function putObject({ kind, originalName, buffer, contentType }) {
  const key = buildStorageKey(kind, originalName);
  if (DRIVER === 'local') {
    await putObjectLocal(key, buffer);
    return key;
  }
  if (DRIVER === 'db') return putObjectDb(key, buffer, contentType);
  if (DRIVER === 's3') return putObjectS3(key, buffer, contentType);
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

/**
 * Retourne un stream Node lisible (à pipe vers la réponse HTTP).
 * Async : le driver s3 récupère l'objet de façon asynchrone.
 */
async function streamObject(storageKey) {
  if (DRIVER === 'local') return streamObjectLocal(storageKey);
  if (DRIVER === 'db') return streamObjectDb(storageKey);
  if (DRIVER === 's3') return streamObjectS3(storageKey);
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

async function deleteObject(storageKey) {
  if (DRIVER === 'local') return deleteObjectLocal(storageKey);
  if (DRIVER === 'db') return deleteObjectDb(storageKey);
  if (DRIVER === 's3') return deleteObjectS3(storageKey);
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

module.exports = {
  DRIVER,
  STORAGE_ROOT,
  DB_MAX_BYTES,
  putObject,
  streamObject,
  deleteObject,
};
