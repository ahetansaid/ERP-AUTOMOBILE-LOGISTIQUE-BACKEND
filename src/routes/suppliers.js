const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const MUTABLE_FIELDS = ['name', 'contactName', 'email', 'phone', 'address'];

function pickMutable(body) {
  const data = {};
  for (const key of MUTABLE_FIELDS) {
    if (body[key] !== undefined) {
      data[key] = body[key] === '' ? null : body[key];
    }
  }
  // Compat snake_case côté front : on accepte aussi contact_name
  if (body.contact_name !== undefined && data.contactName === undefined) {
    data.contactName = body.contact_name === '' ? null : body.contact_name;
  }
  return data;
}

router.get('/', authorize('suppliers', 'read'), async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: req.tenantWhere(),
      orderBy: { name: 'asc' },
    });
    return res.status(200).json({ suppliers, pagination: {} });
  } catch (err) {
    console.error('[suppliers.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/:id', authorize('suppliers', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const supplier = await prisma.supplier.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!supplier) {
      return res
        .status(404)
        .json({ message: 'Fournisseur introuvable', statusCode: 404 });
    }
    return res.status(200).json(supplier);
  } catch (err) {
    console.error('[suppliers.detail]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', authorize('suppliers', 'create'), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name) {
      return res.status(400).json({ message: 'Nom requis', statusCode: 400 });
    }
    const created = await prisma.supplier.create({
      data: { ...pickMutable(body), companyId: req.companyId },
    });
    req.audit({
      action: 'CREATE',
      resource: 'suppliers',
      resourceId: created.id,
      after: created,
    });
    return res.status(201).json(created);
  } catch (err) {
    console.error('[suppliers.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', authorize('suppliers', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const before = await prisma.supplier.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!before) {
      return res
        .status(404)
        .json({ message: 'Fournisseur introuvable', statusCode: 404 });
    }
    const data = pickMutable(req.body || {});
    const updated = Object.keys(data).length
      ? await prisma.supplier.update({ where: { id }, data })
      : before;

    if (Object.keys(data).length) {
      req.audit({
        action: 'UPDATE',
        resource: 'suppliers',
        resourceId: id,
        before,
        after: updated,
      });
    }
    return res.status(200).json(updated);
  } catch (err) {
    console.error('[suppliers.update]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', authorize('suppliers', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const before = await prisma.supplier.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!before) {
      return res
        .status(404)
        .json({ message: 'Fournisseur introuvable', statusCode: 404 });
    }
    await prisma.supplier.delete({ where: { id } });
    req.audit({
      action: 'DELETE',
      resource: 'suppliers',
      resourceId: id,
      before,
    });
    return res.status(204).send();
  } catch (err) {
    console.error('[suppliers.delete]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
