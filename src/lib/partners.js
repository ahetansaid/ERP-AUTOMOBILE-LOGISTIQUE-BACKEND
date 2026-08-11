/**
 * Référentiel des tiers — normalisation et rapprochement.
 *
 * Le problème que ce module résout : dans les données d'origine, un même
 * prestataire apparaissait sous plusieurs orthographes —
 *
 *   « Jean EURO », « Jean (Peintre EURO) », « Peintre Jean EURO »
 *   « Razack », « Soudeur Razack », « Razack (Soudeur EURO) »
 *
 * Impossible, dans ces conditions, de totaliser ce qu'un prestataire a coûté.
 * Le `slug` réduit chaque nom à une forme canonique et sert de clé d'unicité
 * par société : deux graphies du même nom retombent sur le même tiers.
 */

const { prisma } = require('./prisma');

/** Mots de métier retirés du slug : ils décrivent la fonction, pas la personne. */
const TRADE_WORDS = [
  'soudeur', 'soudure', 'peintre', 'peinture', 'mecanicien', 'mecanique',
  'electricien', 'electricite', 'matelassier', 'matelasserie', 'frigoriste',
  'vulganisateur', 'vulcanisateur', 'plasticien', 'plastique', 'minuteur',
  'garage', 'atelier', 'monsieur', 'mr', 'mme',
];

/**
 * Suffixes de parc. VOLONTAIREMENT CONSERVÉS dans le slug.
 *
 * « Jean · Peintre EURO » et « Jean · Peintre USA » sont suivis séparément dans
 * les données d'origine, avec des volumes distincts. Deux lectures possibles :
 * un même Jean intervenant sur deux parcs, ou deux personnes homonymes. Tant
 * que ce n'est pas tranché, les fusionner automatiquement détruirait une
 * information qu'on ne saurait pas reconstituer.
 *
 * Principe retenu : mieux vaut deux tiers qu'on peut fusionner d'un clic qu'un
 * seul qu'on ne peut plus séparer. La fusion est proposée, jamais imposée
 * (voir `suggestMerges`).
 */
const YARD_WORDS = ['euro', 'usa'];

/**
 * Forme canonique d'un nom de tiers.
 *
 * « Razack (Soudeur EURO) » → « razack-euro »
 * « Soudeur Razack »        → « razack »
 * « Jean (Peintre EURO) »   → « jean-euro »
 *
 * Les mots de métier sont retirés — ils décrivent la fonction, pas la personne.
 * Les mots de parc sont gardés. S'il ne reste rien, on retombe sur le nom brut :
 * « Soudeur » seul reste « soudeur », faute de mieux.
 */
function slugify(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base) return '';

  const kept = base
    .split(' ')
    .filter((w) => w.length > 1 && !TRADE_WORDS.includes(w));

  return (kept.length ? kept : base.split(' ')).join('-').slice(0, 255);
}

/** Slug débarrassé aussi du parc — sert uniquement à proposer des fusions. */
function coreSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter((w) => !YARD_WORDS.includes(w))
    .join('-');
}

/** Métier deviné à partir du libellé d'origine, pour préremplir `specialty`. */
function guessSpecialty(name) {
  const n = String(name || '').toLowerCase();
  const map = [
    ['soud', 'Soudure'],
    ['peint', 'Peinture'],
    ['mecan', 'Mécanique'],
    ['electr', 'Électricité'],
    ['matelas', 'Matelasserie'],
    ['frigo', 'Climatisation'],
    ['vulgan', 'Pneumatique'],
    ['vulcan', 'Pneumatique'],
    ['plastic', 'Plasturgie'],
    ['minuteur', 'Clés'],
    ['piece', 'Pièces détachées'],
    ['pièce', 'Pièces détachées'],
  ];
  for (const [needle, label] of map) if (n.includes(needle)) return label;
  return null;
}

/** Ajoute un rôle sans écraser les autres. */
function mergeKinds(existing, kind) {
  const set = new Set(existing || []);
  if (kind) set.add(kind);
  return [...set];
}

/**
 * Retrouve le tiers correspondant à ce nom, ou le crée.
 * Idempotent : deux graphies du même nom rendent le même tiers.
 *
 * @param {string} name
 * @param {'CLIENT'|'FOURNISSEUR'|'PRESTATAIRE'|'TRANSITAIRE'|'TRANSPORTEUR'|'ADMINISTRATION'|'AUTRE'} kind
 * @param {object} [extra] champs complémentaires à la création
 */
async function findOrCreatePartner(name, kind, extra = {}) {
  const slug = slugify(name);
  if (!slug) throw new Error('[partners] nom de tiers vide');

  const existing = await prisma.partner.findFirst({ where: { slug } });
  if (existing) {
    const kinds = mergeKinds(existing.kinds, kind);
    // On n'enrichit que ce qui manque : jamais écraser une saisie humaine.
    const patch = {};
    if (kinds.length !== existing.kinds.length) patch.kinds = kinds;
    if (!existing.specialty && extra.specialty) patch.specialty = extra.specialty;
    if (!existing.phone && extra.phone) patch.phone = extra.phone;
    if (!existing.email && extra.email) patch.email = extra.email;

    if (Object.keys(patch).length) {
      return prisma.partner.update({ where: { id: existing.id }, data: patch });
    }
    return existing;
  }

  return prisma.partner.create({
    data: {
      name: String(name).trim().slice(0, 255),
      slug,
      kinds: kind ? [kind] : [],
      specialty: extra.specialty ?? guessSpecialty(name),
      contactName: extra.contactName ?? null,
      email: extra.email ?? null,
      phone: extra.phone ?? null,
      address: extra.address ?? null,
      city: extra.city ?? null,
      country: extra.country ?? null,
      legalNumber: extra.legalNumber ?? null,
    },
  });
}

/**
 * Propose des regroupements : tiers dont le nom ne diffère que par le parc
 * (« razack » / « razack-euro »). Rien n'est modifié — c'est une suggestion,
 * l'utilisateur tranche.
 */
async function suggestMerges() {
  const partners = await prisma.partner.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, kinds: true, specialty: true },
  });

  const groups = new Map();
  for (const p of partners) {
    const key = coreSlug(p.slug);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, partners: list }));
}

/**
 * Fusionne `sourceId` dans `targetId` : toutes les références basculent, le
 * tiers source est désactivé plutôt que supprimé — on ne détruit pas un
 * référentiel, on l'archive.
 */
async function mergePartners(sourceId, targetId) {
  const src = Number(sourceId);
  const dst = Number(targetId);
  if (src === dst) throw new Error('[partners] source et cible identiques');

  const [source, target] = await Promise.all([
    prisma.partner.findFirst({ where: { id: src } }),
    prisma.partner.findFirst({ where: { id: dst } }),
  ]);
  if (!source || !target) throw new Error('[partners] tiers introuvable');

  const moved = {};
  // Le grand livre est en écriture seule : ses lignes ne peuvent PAS être
  // repointées. Elles restent attachées au tiers source, qui reste donc
  // consultable — c'est cohérent avec l'immuabilité, et l'historique n'est
  // pas réécrit.
  const [wq, clients, suppliers, users] = await Promise.all([
    prisma.workshopQuote.updateMany({ where: { partnerId: src }, data: { partnerId: dst } }),
    prisma.client.updateMany({ where: { partnerId: src }, data: { partnerId: dst } }),
    prisma.supplier.updateMany({ where: { partnerId: src }, data: { partnerId: dst } }),
    prisma.user.updateMany({ where: { partnerId: src }, data: { partnerId: dst } }),
  ]);
  moved.workshopQuotes = wq.count;
  moved.clients = clients.count;
  moved.suppliers = suppliers.count;
  moved.users = users.count;

  await prisma.partner.update({
    where: { id: dst },
    data: {
      kinds: [...new Set([...(target.kinds || []), ...(source.kinds || [])])],
      specialty: target.specialty ?? source.specialty,
      phone: target.phone ?? source.phone,
      email: target.email ?? source.email,
    },
  });

  await prisma.partner.update({
    where: { id: src },
    data: {
      isActive: false,
      notes: [source.notes, `Fusionné dans le tiers #${dst} (${target.name}).`]
        .filter(Boolean)
        .join('\n'),
    },
  });

  return { source: src, target: dst, moved };
}

module.exports = {
  slugify,
  coreSlug,
  guessSpecialty,
  mergeKinds,
  findOrCreatePartner,
  suggestMerges,
  mergePartners,
  TRADE_WORDS,
  YARD_WORDS,
};
