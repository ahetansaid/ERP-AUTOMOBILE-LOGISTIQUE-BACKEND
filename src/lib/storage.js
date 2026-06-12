/**
 * Service stockage fichiers — ParcAuto Manager
 *
 * Drivers supportés :
 *   - `local` (défaut) : filesystem. Pour le dev. NE PAS utiliser sur Vercel
 *     (filesystem éphémère/lecture seule en serverless).
 *   - `s3`             : stockage objet S3-compatible (Cloudflare R2, AWS S3,
 *     MinIO...). Driver de production sur Vercel.
 *
 * Sélection via STORAGE_DRIVER=local|s3.
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
  if (DRIVER === 's3') {
    return putObjectS3(key, buffer, contentType);
  }
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

/**
 * Retourne un stream Node lisible (à pipe vers la réponse HTTP).
 * Async : le driver s3 récupère l'objet de façon asynchrone.
 */
async function streamObject(storageKey) {
  if (DRIVER === 'local') return streamObjectLocal(storageKey);
  if (DRIVER === 's3') return streamObjectS3(storageKey);
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

async function deleteObject(storageKey) {
  if (DRIVER === 'local') return deleteObjectLocal(storageKey);
  if (DRIVER === 's3') return deleteObjectS3(storageKey);
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

module.exports = {
  DRIVER,
  STORAGE_ROOT,
  putObject,
  streamObject,
  deleteObject,
};
