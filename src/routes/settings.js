const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');
const { idDepuisReference } = require('../lib/identite');
const router = express.Router();

/*
 * IDENTITE DE LA SOCIETE
 *
 * Le nom, les mentions legales, les couleurs et le logo qui apparaissent sur
 * les factures et les recus. Ces champs existaient dans le schema depuis le
 * debut ; aucune route ne les ecrivait, et la societe pilote s'appelait donc
 * encore « ParcAuto Principal » sur ses propres documents.
 *
 * L'IFU / RCCM n'est pas un ornement : une facture emise au Benin sans lui
 * n'est pas opposable. Il est donc expose au meme rang que le nom.
 */

/** Couleur hexadecimale, seule forme acceptee — le PDF ne sait pas lire « bleu ». */
const COULEUR = /^#[0-9a-fA-F]{6}$/;

/** Gabarits livres. Une valeur inconnue rendrait un PDF vide sans le dire. */
const GABARITS = ['minimal', 'classic', 'gradient', 'compact'];

const texte = (v, max) => {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

const CHAMPS_IDENTITE = (c) => ({
  id: c.id,
  name: c.name,
  legal_number: c.legalNumber,
  address: c.address,
  phone: c.phone,
  email: c.email,
  country: c.country,
  default_currency: c.defaultCurrency,
  primary_color: c.primaryColor,
  secondary_color: c.secondaryColor,
  invoice_template: c.invoiceTemplate,
  logo_url: c.logoUrl,
  // Le front affiche le logo par cette route : il y joint son cookie, ce que
  // ne peut pas faire le rendu PDF cote serveur (voir lib/identite.js).
  logo_apercu: idDepuisReference(c.logoUrl)
    ? `/uploads/${idDepuisReference(c.logoUrl)}/raw`
    : null,
});

router.get('/company', authorize('settings', 'read'), async (req, res) => {
  try {
    const c = await prisma.company.findFirst({ where: { id: req.companyId } });
    if (!c) return res.status(404).json({ message: 'Societe introuvable', statusCode: 404 });
    return res.status(200).json(CHAMPS_IDENTITE(c));
  } catch (e) {
    console.error('[settings.company.get]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.put('/company', authorize('settings', 'update'), async (req, res) => {
  try {
    const b = req.body || {};
    const data = {};

    const nom = texte(b.name, 255);
    if (nom !== undefined) {
      if (!nom) {
        return res.status(400).json({
          message: 'Le nom de la societe ne peut pas etre vide : il figure sur chaque document.',
          statusCode: 400,
        });
      }
      data.name = nom;
    }

    for (const [cle, champ, max] of [
      ['legal_number', 'legalNumber', 100],
      ['legalNumber', 'legalNumber', 100],
      ['address', 'address', 1000],
      ['phone', 'phone', 50],
      ['email', 'email', 255],
      ['country', 'country', 100],
      ['default_currency', 'defaultCurrency', 10],
      ['defaultCurrency', 'defaultCurrency', 10],
    ]) {
      const v = texte(b[cle], max);
      if (v !== undefined) data[champ] = v;
    }

    for (const [cle, champ] of [
      ['primary_color', 'primaryColor'],
      ['primaryColor', 'primaryColor'],
      ['secondary_color', 'secondaryColor'],
      ['secondaryColor', 'secondaryColor'],
    ]) {
      const v = texte(b[cle], 20);
      if (v === undefined) continue;
      if (v !== null && !COULEUR.test(v)) {
        return res.status(400).json({
          message: `Couleur invalide : « ${v} ». Forme attendue : #1F3F94.`,
          statusCode: 400,
        });
      }
      data[champ] = v;
    }

    const gabarit = texte(b.invoice_template ?? b.invoiceTemplate, 50);
    if (gabarit !== undefined) {
      if (gabarit !== null && !GABARITS.includes(gabarit)) {
        return res.status(400).json({
          message: `Gabarit inconnu : « ${gabarit} ». Valeurs : ${GABARITS.join(', ')}.`,
          statusCode: 400,
        });
      }
      data.invoiceTemplate = gabarit;
    }

    /*
     * Le logo est designe par « upload:<id> », et cet identifiant est VERIFIE :
     * l'upload doit exister, appartenir a la societe courante et etre de type
     * COMPANY_LOGO. Sans ce controle, une societe pourrait pointer le fichier
     * d'une autre et le voir apparaitre sur ses factures — la reference
     * traverserait l'isolation que tout le reste du systeme fait respecter.
     */
    const logo = texte(b.logo_url ?? b.logoUrl, 500);
    if (logo !== undefined) {
      if (logo === null) {
        data.logoUrl = null;
      } else {
        const uploadId = idDepuisReference(logo);
        if (uploadId == null) {
          return res.status(400).json({
            message: 'Reference de logo invalide. Forme attendue : upload:<id>, '
              + "obtenue en televersant l'image avec le type COMPANY_LOGO.",
            statusCode: 400,
          });
        }
        const piece = await prisma.upload.findFirst({
          where: { id: uploadId, ...req.tenantWhere() },
          select: { id: true, kind: true },
        });
        if (!piece) {
          return res.status(404).json({ message: 'Fichier de logo introuvable', statusCode: 404 });
        }
        if (piece.kind !== 'COMPANY_LOGO') {
          return res.status(400).json({
            message: `Ce fichier est de type ${piece.kind}, pas COMPANY_LOGO.`,
            statusCode: 400,
          });
        }
        data.logoUrl = `upload:${uploadId}`;
      }
    }

    if (!Object.keys(data).length) {
      const actuel = await prisma.company.findFirst({ where: { id: req.companyId } });
      return res.status(200).json(CHAMPS_IDENTITE(actuel));
    }

    await prisma.company.update({ where: { id: req.companyId }, data });
    const maj = await prisma.company.findFirst({ where: { id: req.companyId } });
    return res.status(200).json(CHAMPS_IDENTITE(maj));
  } catch (e) {
    console.error('[settings.company.put]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/rates', authorize('settings', 'read'), async (req, res) => {
  try {
    const companyId = req.companyId;
    try {
      const rows = await prisma.exchangeRate.findMany({
        where: {
          isActive: true,
          ...(companyId ? { companyId: Number(companyId) } : {}),
        },
        select: { currency: true, rateFcfa: true },
      });
      const rates = {};
      rows.forEach((r) => {
        rates[r.currency] = Number(r.rateFcfa);
      });
      return res.status(200).json({ rates });
    } catch (e) {
      return res.status(200).json({ rates: { USD: 600, EUR: 655 } });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.put('/rates', authorize('settings', 'update'), async (req, res) => {
  try {
    const { USD, EUR } = req.body || {};
    const companyId = req.companyId;
    const companyWhere = companyId ? { companyId: Number(companyId) } : {};
    try {
      if (USD != null) {
        await prisma.exchangeRate.updateMany({
          where: { currency: 'USD', ...companyWhere },
          data: { rateFcfa: USD, isActive: true },
        });
      }
      if (EUR != null) {
        await prisma.exchangeRate.updateMany({
          where: { currency: 'EUR', ...companyWhere },
          data: { rateFcfa: EUR, isActive: true },
        });
      }
    } catch (e) {}

    let rows = [];
    try {
      rows = await prisma.exchangeRate.findMany({
        where: { isActive: true, ...companyWhere },
        select: { currency: true, rateFcfa: true },
      });
    } catch (e) {
      rows = [];
    }
    const rates = {};
    rows.forEach((r) => { rates[r.currency] = Number(r.rateFcfa); });
    if (Object.keys(rates).length === 0) return res.status(200).json({ rates: { USD: USD ?? 600, EUR: EUR ?? 655 } });
    return res.status(200).json({ rates });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
