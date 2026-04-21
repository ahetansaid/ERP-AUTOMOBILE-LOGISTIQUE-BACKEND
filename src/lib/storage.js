/**
 * Service stockage fichiers — ParcAuto Manager
 *
 * Driver par défaut : `local` (filesystem). Swap S3/MinIO plus tard via
 * STORAGE_DRIVER=s3 (à implémenter).
 *
 * Clé de stockage : {kind}/{YYYY}/{MM}/{uuid}.{ext}
 * Les fichiers sont servis via GET /uploads/:id (endpoint protégé).
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

async function putObjectLocal(storageKey, buffer) {
  const abs = path.join(STORAGE_ROOT, storageKey);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
  return abs;
}

async function getObjectLocal(storageKey) {
  const abs = path.join(STORAGE_ROOT, storageKey);
  if (!fs.existsSync(abs)) {
    throw new Error(`Fichier introuvable : ${storageKey}`);
  }
  return fsp.readFile(abs);
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

/**
 * Persiste un buffer en stockage. Retourne la `storageKey`.
 */
async function putObject({ kind, originalName, buffer }) {
  const key = buildStorageKey(kind, originalName);
  if (DRIVER === 'local') {
    await putObjectLocal(key, buffer);
    return key;
  }
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

function streamObject(storageKey) {
  if (DRIVER === 'local') return streamObjectLocal(storageKey);
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

async function deleteObject(storageKey) {
  if (DRIVER === 'local') return deleteObjectLocal(storageKey);
  throw new Error(`Driver stockage non supporté : ${DRIVER}`);
}

module.exports = {
  DRIVER,
  STORAGE_ROOT,
  putObject,
  streamObject,
  deleteObject,
  getObjectLocal,
};
