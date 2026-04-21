const express = require('express');
const multer = require('multer');
const mime = require('mime-types');
const { prisma } = require('../lib/prisma');
const { putObject, streamObject, deleteObject } = require('../lib/storage');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

// Upload en mémoire (max 25MB). On lit le buffer puis on appelle storage.putObject.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const ALLOWED_KINDS = [
  'VEHICLE_PHOTO',
  'PURCHASE_DOCUMENT',
  'INVOICE_PDF',
  'RECEIPT_PDF',
  'QUOTE_PDF',
  'PROFORMA_PDF',
  'TRANSIT_DOCUMENT',
  'COMPANY_LOGO',
  'USER_AVATAR',
  'OTHER',
];

// Whitelist de types acceptés par kind (simple protection)
const ALLOWED_MIME = {
  VEHICLE_PHOTO: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  COMPANY_LOGO: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
  USER_AVATAR: ['image/jpeg', 'image/png', 'image/webp'],
  // Les documents acceptent aussi PDF
  PURCHASE_DOCUMENT: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
  TRANSIT_DOCUMENT: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
  INVOICE_PDF: ['application/pdf'],
  RECEIPT_PDF: ['application/pdf'],
  QUOTE_PDF: ['application/pdf'],
  PROFORMA_PDF: ['application/pdf'],
  OTHER: null, // tout accepté
};

function validateMime(kind, mimeType) {
  const list = ALLOWED_MIME[kind];
  if (!list) return true; // OTHER
  return list.includes(mimeType);
}

/**
 * POST /uploads
 * multipart/form-data
 *   - file: fichier
 *   - kind: VEHICLE_PHOTO | PURCHASE_DOCUMENT | ... (required)
 *   - resource?: 'vehicles' (type de ressource liée)
 *   - resourceId?: 42 (id de la ressource liée)
 */
router.post(
  '/',
  authorize('uploads', 'create'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: 'Aucun fichier fourni (champ "file")', statusCode: 400 });
      }
      const kind = String(req.body.kind || '').toUpperCase();
      if (!ALLOWED_KINDS.includes(kind)) {
        return res.status(400).json({
          message: `Kind invalide. Valeurs : ${ALLOWED_KINDS.join(', ')}`,
          statusCode: 400,
        });
      }
      if (!validateMime(kind, req.file.mimetype)) {
        return res.status(415).json({
          message: `Type de fichier non supporté pour ${kind} : ${req.file.mimetype}`,
          statusCode: 415,
        });
      }

      const resource = req.body.resource || null;
      const resourceId = req.body.resourceId
        ? Number(req.body.resourceId)
        : null;

      const storageKey = await putObject({
        kind,
        originalName: req.file.originalname,
        buffer: req.file.buffer,
      });

      const row = await prisma.upload.create({
        data: {
          companyId: req.companyId ?? null,
          uploadedBy: req.user?.id ?? null,
          kind,
          resource,
          resourceId,
          fileName: req.file.originalname?.slice(0, 500) || 'upload',
          mimeType: req.file.mimetype.slice(0, 100),
          sizeBytes: BigInt(req.file.size),
          storageKey,
        },
      });

      if (req.audit) {
        req.audit({
          action: 'CREATE',
          resource: 'uploads',
          resourceId: row.id,
          after: { id: row.id, kind, resource, resourceId, size: req.file.size },
        });
      }

      return res.status(201).json(serialize(row));
    } catch (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res
          .status(413)
          .json({ message: 'Fichier trop lourd (max 25 MB)', statusCode: 413 });
      }
      console.error('[uploads.create]', err);
      return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
    }
  }
);

// GET /uploads?resource=vehicles&resourceId=42&kind=VEHICLE_PHOTO — liste
router.get('/', authorize('uploads', 'read'), async (req, res) => {
  try {
    const where = { ...req.tenantWhere() };
    if (req.query.kind) where.kind = String(req.query.kind).toUpperCase();
    if (req.query.resource) where.resource = String(req.query.resource);
    if (req.query.resourceId) where.resourceId = Number(req.query.resourceId);

    const rows = await prisma.upload.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
    });
    return res.status(200).json({ uploads: rows.map(serialize) });
  } catch (err) {
    console.error('[uploads.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /uploads/:id — métadonnées
router.get('/:id', authorize('uploads', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const row = await prisma.upload.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!row) {
      return res
        .status(404)
        .json({ message: 'Fichier introuvable', statusCode: 404 });
    }
    return res.status(200).json(serialize(row));
  } catch (err) {
    console.error('[uploads.detail]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /uploads/:id/raw — stream du fichier
router.get('/:id/raw', authorize('uploads', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const row = await prisma.upload.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!row) {
      return res
        .status(404)
        .json({ message: 'Fichier introuvable', statusCode: 404 });
    }

    const stream = streamObject(row.storageKey);
    const type =
      row.mimeType || mime.lookup(row.fileName) || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(row.fileName)}"`
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
    stream.on('error', (e) => {
      console.error('[uploads.stream]', e);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Erreur lecture fichier', statusCode: 500 });
      }
    });
  } catch (err) {
    console.error('[uploads.raw]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// DELETE /uploads/:id
router.delete('/:id', authorize('uploads', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const row = await prisma.upload.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!row) {
      return res
        .status(404)
        .json({ message: 'Fichier introuvable', statusCode: 404 });
    }
    await prisma.upload.delete({ where: { id } });
    try {
      await deleteObject(row.storageKey);
    } catch (e) {
      console.error('[uploads.delete.storage]', e.message);
    }
    if (req.audit) {
      req.audit({
        action: 'DELETE',
        resource: 'uploads',
        resourceId: id,
        before: serialize(row),
      });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('[uploads.delete]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// Sérialise (BigInt → number/string) pour JSON
function serialize(row) {
  return {
    id: row.id,
    companyId: row.companyId,
    uploadedBy: row.uploadedBy,
    kind: row.kind,
    resource: row.resource,
    resourceId: row.resourceId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes), // BigInt → number (ok jusqu'à ~9 PB)
    storageKey: row.storageKey,
    publicUrl: row.publicUrl,
    version: row.version,
    createdAt: row.createdAt,
  };
}

module.exports = router;
