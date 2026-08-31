/**
 * Identité de la société émettrice : nom, mentions légales, couleurs, logo.
 *
 * POURQUOI CE N'EST PAS UN FICHIER DANS LE FRONT
 *
 * La plateforme est multi-sociétés. Déposer « Logo KADIE AUTO.png » dans les
 * assets du front ferait apparaître ce logo sur les factures de tous les
 * clients suivants. L'identité appartient à l'enregistrement de la société,
 * pas au code.
 *
 * COMMENT LE LOGO EST RÉFÉRENCÉ
 *
 * `Company.logoUrl` porte `upload:<id>` plutôt que le binaire ou une URL
 * publique, et ce choix n'est pas cosmétique :
 *
 *   · la colonne fait 500 caractères — une image encodée n'y tiendrait pas ;
 *   · le fichier vit déjà dans le circuit d'`Upload`, avec son contrôle de
 *     type MIME, son plafond de taille, son isolation par société et sa
 *     suppression ;
 *   · une URL publique supposerait un bucket ouvert, que ce déploiement n'a
 *     pas — et n'a pas à avoir.
 *
 * Le PDF, lui, ne peut pas aller chercher une URL protégée par cookie : il est
 * rendu côté serveur, sans session. On lui remet donc le binaire directement,
 * en data URI. C'est la raison d'être de `logoDataUri`.
 */

const { prisma } = require('./prisma');
const { streamObject } = require('./storage');

/** Types acceptés pour un logo — les mêmes que la route d'upload. */
const MIME_LOGO = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Plafond de lecture du logo, indépendant du plafond d'upload.
 *
 * Un logo est relu à CHAQUE rendu de PDF. À 2 Mo, une facture coûterait deux
 * mégaoctets de mémoire et de latence pour un carré de 46 points de côté. Le
 * refus est silencieux — un document sans logo vaut mieux qu'un document qui
 * ne se génère pas.
 */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** `upload:123` → 123. Toute autre forme rend null. */
function idDepuisReference(logoUrl) {
  const m = /^upload:(\d+)$/.exec(String(logoUrl ?? '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Le logo de la société, en data URI, prêt pour react-pdf.
 *
 * Rend null dès que quoi que ce soit manque ou dépasse : aucune de ces
 * situations ne justifie de faire échouer une facture.
 */
async function logoDataUri(logoUrl) {
  const uploadId = idDepuisReference(logoUrl);
  if (uploadId == null) return null;

  try {
    const upload = await prisma.upload.findFirst({
      where: { id: uploadId },
      select: { storageKey: true, mimeType: true },
    });
    if (!upload?.storageKey) return null;

    const mime = String(upload.mimeType || 'image/png').toLowerCase();
    if (!MIME_LOGO.has(mime)) return null;

    const flux = await streamObject(upload.storageKey);
    const morceaux = [];
    let taille = 0;
    for await (const morceau of flux) {
      taille += morceau.length;
      if (taille > LOGO_MAX_BYTES) return null;
      morceaux.push(morceau);
    }

    return `data:${mime};base64,${Buffer.concat(morceaux).toString('base64')}`;
  } catch {
    // Blob absent, pilote de stockage en panne, fichier corrompu : le document
    // sort sans logo. C'est un défaut d'apparence, pas de comptabilité.
    return null;
  }
}

/**
 * Le bloc « émetteur » d'un document, tel que les gabarits l'attendent.
 *
 * Seule la facture produit un PDF aujourd'hui. Le bloc est isolé ici pour que
 * les reçus et les devis, quand ils en produiront un, présentent exactement la
 * même identité : c'est en le recopiant une deuxième fois qu'on le ferait
 * diverger, et c'est le nom de la société sur une pièce remise au client.
 */
async function identiteEmetteur(company) {
  if (!company) return { from: { name: 'ParcAuto Manager' }, brand: {} };

  return {
    from: {
      name: company.name || 'ParcAuto Manager',
      address: company.address || undefined,
      country: company.country || undefined,
      phone: company.phone || undefined,
      email: company.email || undefined,
      legalNumber: company.legalNumber || undefined,
    },
    brand: {
      name: company.name || undefined,
      color: company.primaryColor || '#6366F1',
      colorSecondary: company.secondaryColor || undefined,
      logo: await logoDataUri(company.logoUrl),
    },
  };
}

module.exports = {
  MIME_LOGO,
  LOGO_MAX_BYTES,
  idDepuisReference,
  logoDataUri,
  identiteEmetteur,
};
