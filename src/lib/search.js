/**
 * Recherche universelle.
 *
 * On tape un numéro quelconque, la plateforme identifie de quoi il s'agit :
 *
 *   852354            → VIN partiel      → MERCEDES C350
 *   HAMU 1376147      → conteneur        → 4 véhicules
 *   HLCUMTR260301164  → connaissement    → dossier transit
 *   DACHAN BAY        → navire           → conteneurs concernés
 *   FAV-2026-0042     → facture
 *   Dieudonné         → prestataire
 *
 * Point de méthode : la recherche par les SIX DERNIERS caractères du VIN est
 * traitée comme un identifiant de plein droit. C'est le langage réel des
 * utilisateurs — dans les classeurs, un véhicule s'appelle « MERCEDES 852354 ».
 * On n'a pas cherché à corriger l'habitude, on l'a absorbée.
 */

const { prisma, prismaRaw } = require('./prisma');
const { getContext } = require('./context');
const { logger } = require('./logger');

const log = logger('search');

const clean = (v) =>
  v == null ? null : String(v).trim().replace(/\s+/g, ' ').slice(0, 255) || null;

/** Forme de comparaison : minuscules, sans accent ni séparateur. */
const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Registre des entités indexées.
 *
 * Chaque entrée dit comment lire une ligne : quoi afficher, et quels
 * identifiants rendent l'objet retrouvable. Ajouter un modèle ici suffit à le
 * rendre cherchable — aucune autre modification n'est nécessaire.
 */
const INDEXABLE = {
  Vehicle: {
    badge: 'VÉH',
    route: 'vehicules',
    include: { client: { select: { name: true } } },
    label: (v) => [v.brand, v.model, v.year].filter(Boolean).join(' ') || v.vin || `Véhicule ${v.id}`,
    subtitle: (v) => [v.vin, v.status].filter(Boolean).join(' · '),
    identifiers: (v) => [v.vin, v.vin?.slice(-6), v.registration],
    text: (v) => [v.brand, v.model, v.year, v.color, v.vin, v.client?.name].filter(Boolean).join(' '),
  },
  Purchase: {
    badge: 'CNT',
    route: 'supply-chain/achats',
    label: (p) => p.containerReference || `Achat ${p.id}`,
    subtitle: (p) => [p.vessel, p.supplierName].filter(Boolean).join(' · '),
    identifiers: (p) => [p.containerReference, p.containerReference?.replace(/\s/g, ''), p.vessel],
    text: (p) => [p.containerReference, p.vessel, p.supplierName, p.purchaseType].filter(Boolean).join(' '),
  },
  Invoice: {
    badge: 'FAC',
    route: 'comptabilite/factures',
    include: { client: { select: { name: true } }, vehicle: { select: { vin: true } } },
    label: (i) => i.invoiceNumber || `Facture ${i.id}`,
    subtitle: (i) => [i.client?.name, i.vehicle?.vin].filter(Boolean).join(' · '),
    identifiers: (i) => [i.invoiceNumber, i.vehicle?.vin, i.vehicle?.vin?.slice(-6)],
    text: (i) => [i.invoiceNumber, i.client?.name, i.vehicle?.vin, i.status].filter(Boolean).join(' '),
  },
  Receipt: {
    badge: 'REC',
    route: 'comptabilite/recus',
    label: (r) => r.receiptNumber || `Reçu ${r.id}`,
    subtitle: (r) => [r.reference, r.paymentMethod].filter(Boolean).join(' · '),
    identifiers: (r) => [r.receiptNumber, r.reference],
    text: (r) => [r.receiptNumber, r.reference, r.paymentMethod].filter(Boolean).join(' '),
  },
  Partner: {
    badge: 'TRS',
    route: 'tiers',
    label: (p) => p.name,
    subtitle: (p) => [p.specialty, (p.kinds || []).join(', ')].filter(Boolean).join(' · '),
    identifiers: (p) => [p.slug, p.phone, p.email, p.legalNumber],
    text: (p) => [p.name, p.slug, p.specialty, p.city, p.country].filter(Boolean).join(' '),
  },
  Client: {
    badge: 'CLI',
    route: 'crm',
    label: (c) => c.name,
    subtitle: (c) => [c.city, c.country, c.phone].filter(Boolean).join(' · '),
    identifiers: (c) => [c.phone, c.email],
    text: (c) => [c.name, c.city, c.country, c.email, c.phone].filter(Boolean).join(' '),
  },
  Supplier: {
    badge: 'FRN',
    route: 'supply-chain/achats',
    label: (s) => s.name,
    subtitle: (s) => [s.contactName, s.phone].filter(Boolean).join(' · '),
    identifiers: (s) => [s.phone, s.email],
    text: (s) => [s.name, s.contactName, s.email, s.phone].filter(Boolean).join(' '),
  },
  WorkshopQuote: {
    badge: 'ATL',
    route: 'comptabilite/devis',
    include: { vehicle: { select: { vin: true, brand: true } } },
    label: (q) => `Devis ${q.id} — ${q.prestataire}`,
    subtitle: (q) => [q.vehicle?.vin, q.status].filter(Boolean).join(' · '),
    identifiers: (q) => [q.vehicle?.vin, q.vehicle?.vin?.slice(-6)],
    text: (q) => [q.prestataire, q.description, q.vehicle?.vin, q.vehicle?.brand].filter(Boolean).join(' '),
  },
};

const INDEXED_MODELS = new Set(Object.keys(INDEXABLE));

/** Nom d'accès Prisma d'un modèle : Vehicle → vehicle. */
const accessor = (model) => model[0].toLowerCase() + model.slice(1);

/**
 * (Ré)indexe une entité. Fire-and-forget : une erreur d'indexation ne doit
 * jamais faire échouer l'écriture métier qui l'a déclenchée.
 *
 * Utilise le client BRUT et un companyId explicite : appelée depuis l'extension
 * Prisma, elle ne doit pas repasser par elle (récursion).
 */
async function reindex(model, entityId, companyId) {
  const spec = INDEXABLE[model];
  if (!spec || entityId == null || companyId == null) return;

  try {
    const row = await prismaRaw[accessor(model)].findFirst({
      where: { id: Number(entityId), companyId: Number(companyId) },
      ...(spec.include ? { include: spec.include } : {}),
    });

    if (!row) {
      await prismaRaw.searchIndex.deleteMany({
        where: { companyId: Number(companyId), entityType: model, entityId: Number(entityId) },
      });
      return;
    }

    const identifiers = [...new Set((spec.identifiers(row) || []).map(clean).filter(Boolean))];
    const data = {
      companyId: Number(companyId),
      entityType: model,
      entityId: Number(entityId),
      label: clean(spec.label(row)) || `${model} ${entityId}`,
      subtitle: clean(spec.subtitle(row)),
      identifiers,
      searchText: String(spec.text(row) || '').slice(0, 2000),
    };

    await prismaRaw.searchIndex.upsert({
      where: {
        companyId_entityType_entityId: {
          companyId: data.companyId,
          entityType: model,
          entityId: data.entityId,
        },
      },
      create: data,
      update: data,
    });
  } catch (err) {
    log.error('indexation impossible', { err, model, entityId });
  }
}

/** Retire une entité de l'index (après suppression). */
async function unindex(model, entityId, companyId) {
  if (!INDEXED_MODELS.has(model) || entityId == null || companyId == null) return;
  try {
    await prismaRaw.searchIndex.deleteMany({
      where: { companyId: Number(companyId), entityType: model, entityId: Number(entityId) },
    });
  } catch (err) {
    log.error('désindexation impossible', { err, model, entityId });
  }
}

/**
 * Recherche.
 *
 * Deux passes, dans cet ordre :
 *   1. identifiants — correspondance exacte puis par préfixe. C'est le cas
 *      « je tape un numéro » : la réponse doit être immédiate et sans bruit.
 *   2. texte libre — filet de sécurité quand rien ne matche.
 */
async function search(query, { limit = 12 } = {}) {
  const ctx = getContext();
  if (!ctx?.companyId) throw new Error('[search] hors contexte société');
  const q = String(query || '').trim();
  if (!q) return [];

  const n = norm(q);
  if (!n) return [];

  const rows = await prisma.searchIndex.findMany({
    where: {
      OR: [
        { identifiers: { hasSome: [q, q.toUpperCase(), q.toLowerCase()] } },
        { label: { contains: q, mode: 'insensitive' } },
        { subtitle: { contains: q, mode: 'insensitive' } },
        { searchText: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 200,
  });

  // Le classement se fait en mémoire : la comparaison normalisée (sans accent
  // ni séparateur) n'est pas exprimable simplement en SQL portable, et le
  // volume ramené reste petit.
  const scored = rows
    .map((r) => {
      const ids = (r.identifiers || []).map(norm);
      let score = 0;
      if (ids.some((i) => i === n)) score = 100;
      else if (ids.some((i) => i.endsWith(n) && n.length >= 4)) score = 90; // VIN partiel
      else if (ids.some((i) => i.startsWith(n))) score = 80;
      else if (ids.some((i) => i.includes(n))) score = 65;
      else if (norm(r.label).includes(n)) score = 45;
      else if (norm(r.subtitle).includes(n)) score = 30;
      else if (norm(r.searchText).includes(n)) score = 15;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.label.localeCompare(b.r.label))
    .slice(0, limit);

  return scored.map(({ r, score }) => ({
    type: r.entityType,
    id: r.entityId,
    badge: INDEXABLE[r.entityType]?.badge ?? '—',
    route: INDEXABLE[r.entityType]?.route ?? null,
    label: r.label,
    subtitle: r.subtitle,
    score,
  }));
}

/**
 * Reconstruit l'index complet de la société courante.
 * À lancer une fois après la migration, puis en cas de doute.
 */
async function rebuildIndex() {
  const ctx = getContext();
  if (!ctx?.companyId) throw new Error('[search] hors contexte société');
  const companyId = ctx.companyId;

  const counts = {};
  for (const model of INDEXED_MODELS) {
    const rows = await prismaRaw[accessor(model)].findMany({
      where: { companyId },
      select: { id: true },
    });
    for (const { id } of rows) await reindex(model, id, companyId);
    counts[model] = rows.length;
  }
  return counts;
}

module.exports = { search, reindex, unindex, rebuildIndex, INDEXABLE, INDEXED_MODELS };
