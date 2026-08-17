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
  'FACTURE_NORMALISEE',
  'RECU_NORMALISE',
  'DOCUMENT_DOUANE',
  'TRANSIT_DOCUMENT',
  'COMPANY_LOGO',
  'USER_AVATAR',
  'OTHER',
];

// Pièces fiscales externes : le numéro du document est exigé, sinon la pièce
// est inexploitable pour le rapprochement — on ne saurait pas à quoi elle
// correspond une fois le fichier archivé.
const FISCAL_KINDS = new Set([
  'FACTURE_NORMALISEE',
  'RECU_NORMALISE',
  'DOCUMENT_DOUANE',
]);

// Whitelist de types acceptés par kind (simple protection)
const ALLOWED_MIME = {
  VEHICLE_PHOTO: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  // Pas de SVG : un SVG embarque du script, et il était servi en inline.
  COMPANY_LOGO: ['image/jpeg', 'image/png', 'image/webp'],
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
  // Les pièces fiscales arrivent souvent en photo prise au téléphone.
  FACTURE_NORMALISEE: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  RECU_NORMALISE: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  DOCUMENT_DOUANE: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  OTHER: null, // tout accepté
};

/**
 * Types autorisés pour OTHER.
 *
 * `if (!list) return true` faisait de OTHER un contournement complet : n'importe
 * quel type déclaré passait, y compris text/html, et le fichier était ensuite
 * SERVI avec ce type en `Content-Disposition: inline`. Le navigateur le rendait.
 * OTHER a désormais sa liste, comme les autres.
 */
const MIME_OTHER = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

/**
 * Types que le navigateur peut afficher SANS risque d'exécuter du script.
 *
 * Tout ce qui n'est pas là est servi en pièce jointe. Un SVG est une image pour
 * l'œil et un document scriptable pour le navigateur : il n'a rien à faire ici.
 */
const AFFICHABLES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function validateMime(kind, mimeType) {
  const list = kind === 'OTHER' ? MIME_OTHER : ALLOWED_MIME[kind];
  if (!list) return false; // aucun type connu pour ce kind : on refuse
  return list.includes(mimeType);
}

/**
 * Type à renvoyer au navigateur.
 *
 * JAMAIS celui déclaré par le client tel quel : il décide comment le navigateur
 * traite le contenu. On ne ressort que les types que la plateforme a acceptés à
 * l'entrée ; tout le reste devient un flux d'octets anonyme.
 */
function mimeDeSortie(kind, stocke) {
  const autorises = kind === 'OTHER' ? MIME_OTHER : ALLOWED_MIME[kind] || [];
  return autorises.includes(stocke) ? stocke : 'application/octet-stream';
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

      // Métadonnées de la pièce externe.
      const docNumber = req.body.docNumber
        ? String(req.body.docNumber).trim().slice(0, 100)
        : null;
      const docDate = req.body.docDate ? new Date(req.body.docDate) : null;
      const docAmount =
        req.body.docAmount != null && req.body.docAmount !== ''
          ? Number(req.body.docAmount)
          : null;

      if (FISCAL_KINDS.has(kind)) {
        if (!docNumber) {
          return res.status(400).json({
            message:
              'Le numéro du document est requis pour une pièce fiscale : sans lui, la pièce ne peut pas être rapprochée.',
            statusCode: 400,
          });
        }
        if (!resource || !Number.isInteger(resourceId)) {
          return res.status(400).json({
            message:
              'Une pièce fiscale doit être rattachée à une entité (resource + resourceId).',
            statusCode: 400,
          });
        }
      }
      if (docDate && Number.isNaN(docDate.getTime())) {
        return res.status(400).json({ message: 'docDate invalide', statusCode: 400 });
      }
      if (docAmount != null && Number.isNaN(docAmount)) {
        return res.status(400).json({ message: 'docAmount invalide', statusCode: 400 });
      }

      const storageKey = await putObject({
        kind,
        originalName: req.file.originalname,
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
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
          docNumber,
          docDate,
          docAmount,
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

/**
 * GET /uploads/controle — pièces fiscales manquantes
 *
 * La plateforme n'émet pas de document certifié : c'est l'utilisateur qui
 * rattache la pièce établie ailleurs. Ce contrôle répond donc à la seule
 * question qui compte : « qu'est-ce qui a été vendu ou encaissé sans que la
 * pièce correspondante ait été jointe ? »
 *
 * Déclarée AVANT `/:id`, sinon Express interpréterait « controle » comme un id.
 */
router.get('/controle', authorize('uploads', 'read'), async (req, res) => {
  try {
    const [invoices, receipts, attached] = await Promise.all([
      prisma.invoice.findMany({
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          createdAt: true,
          client: { select: { name: true } },
          vehicle: { select: { vin: true } },
        },
        orderBy: { id: 'desc' },
        take: 500,
      }),
      prisma.receipt.findMany({
        select: { id: true, receiptNumber: true, amount: true, paymentDate: true },
        orderBy: { id: 'desc' },
        take: 500,
      }),
      prisma.upload.findMany({
        where: { kind: { in: ['FACTURE_NORMALISEE', 'RECU_NORMALISE'] } },
        select: { resource: true, resourceId: true, kind: true },
      }),
    ]);

    const has = new Set(attached.map((u) => `${u.resource}:${u.resourceId}`));

    const facturesSansPiece = invoices
      .filter((i) => !has.has(`invoices:${i.id}`))
      .map((i) => ({
        id: i.id,
        numero: i.invoiceNumber,
        montant: Number(i.totalAmount),
        date: i.createdAt,
        client: i.client?.name ?? null,
        vin: i.vehicle?.vin ?? null,
      }));

    const recusSansPiece = receipts
      .filter((r) => !has.has(`receipts:${r.id}`))
      .map((r) => ({
        id: r.id,
        numero: r.receiptNumber,
        montant: Number(r.amount),
        date: r.paymentDate,
      }));

    return res.status(200).json({
      factures: {
        total: invoices.length,
        sansPiece: facturesSansPiece.length,
        montantSansPiece: facturesSansPiece.reduce((s, f) => s + f.montant, 0),
        lignes: facturesSansPiece.slice(0, 100),
      },
      recus: {
        total: receipts.length,
        sansPiece: recusSansPiece.length,
        montantSansPiece: recusSansPiece.reduce((s, r) => s + r.montant, 0),
        lignes: recusSansPiece.slice(0, 100),
      },
    });
  } catch (err) {
    console.error('[uploads.controle]', err);
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

    const stream = await streamObject(row.storageKey);

    // Le type est ramené à ce que la plateforme a accepté pour ce kind, et
    // l'affichage direct réservé à ce qui ne peut pas porter de script. Le
    // reste part en pièce jointe : le navigateur le télécharge au lieu de
    // l'interpréter.
    const type = mimeDeSortie(row.kind, row.mimeType);
    const disposition = AFFICHABLES.has(type) ? 'inline' : 'attachment';

    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(row.fileName)}"`
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
    docNumber: row.docNumber ?? null,
    docDate: row.docDate ?? null,
    docAmount: row.docAmount != null ? Number(row.docAmount) : null,
    createdAt: row.createdAt,
  };
}

module.exports = router;
