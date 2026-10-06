/**
 * Connecteur e-MECeF — facture normalisée, DGI Bénin.
 *
 * CE QUE LA PLATEFORME FAIT, ET CE QU'ELLE NE FAIT PAS
 *
 * Elle ne certifie rien. Elle transmet une facture à la DGI, reçoit en retour
 * un `codeMECeFDGI` et un QR code, et les conserve. C'est la DGI qui certifie ;
 * la plateforme est un porteur de message qui garde la preuve du message.
 *
 * Cette distinction n'est pas rhétorique : elle décide de ce qu'on stocke. On
 * garde ce que la DGI a RENVOYÉ, et aussi ce qu'on lui a ENVOYÉ, parce qu'en
 * cas de contrôle la question sera « qu'avez-vous déclaré », pas « qu'affiche
 * votre écran aujourd'hui ».
 *
 * AUCUNE DÉPENDANCE
 *
 * Il existe des clients tiers pour cette API. Aucun n'est audité, et celui-ci
 * se trouve sur le chemin fiscal : une facture fausse ou perdue se paie en
 * redressement. C'est du HTTP et un JWT — vingt lignes, lisibles, à nous.
 *
 * ENFICHABLE PAR PAYS
 *
 * Le Bénin impose e-MECeF, le Togo et la Côte d'Ivoire ont leurs équivalents.
 * L'interface publique de ce module — `normaliser(facture)` rendant un
 * `{ code, qrCode, uid }` — est celle qu'un connecteur togolais devra servir.
 * Rien ici ne doit remonter dans les routes sous forme béninoise.
 *
 * POURQUOI DEUX APPELS PLUTÔT QU'UN
 *
 * L'API offre un `normalizeInvoice` qui crée et confirme d'un coup. C'est plus
 * simple et c'est un piège : si la réponse se perd en route, on ignore si la
 * facture existe chez la DGI, et on n'a aucun identifiant pour le lui demander.
 *
 * En deux temps — créer, puis confirmer — l'`uid` est connu et persisté AVANT
 * la confirmation. Une coupure entre les deux laisse une facture en attente
 * qu'on retrouve, qu'on confirme ou qu'on annule. On échange une latence
 * contre la capacité à se rattraper, et sur une pièce fiscale c'est un bon
 * change.
 */

const BASE_DEFAUT = 'https://developper.impots.bj/sygmef-emcf/api';

/** Erreur portant le code applicatif de la DGI, pas seulement un message. */
class ErreurMecef extends Error {
  constructor(message, { code = null, http = null, details = null } = {}) {
    super(message);
    this.name = 'ErreurMecef';
    this.code = code;
    this.http = http;
    this.details = details;
  }
}

/**
 * Codes applicatifs renvoyés par la DGI, traduits en langage d'utilisateur.
 *
 * Un « code 8 » dans un journal n'aide personne. Ces libellés sont ce que
 * l'écran affichera, et ils disent quoi faire quand c'est possible.
 */
const CODES = {
  1: 'Trop de factures en attente chez la DGI. Confirmez ou annulez les précédentes avant d’en envoyer une nouvelle.',
  3: 'Type de facture refusé par la DGI.',
  8: 'La facture ne contient aucun article — la DGI la refuse.',
  20: 'Facture inexistante chez la DGI, ou déjà finalisée ou annulée.',
  99: 'Erreur interne de la plateforme DGI. Réessayez plus tard sans modifier la facture.',
};

const message = (code, secours) => CODES[code] ?? secours ?? `Erreur e-MECeF (code ${code}).`;

/**
 * Montant tel que la DGI l'attend.
 *
 * Le franc CFA n'a pas de subdivision : un centime envoyé est un rejet, ou pire
 * un écart d'un franc entre la facture papier et la déclaration. On arrondit
 * ici, une fois, plutôt que d'espérer que l'appelant l'ait fait.
 */
const montant = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new ErreurMecef(`Montant illisible : « ${v} »`);
  return n;
};

/**
 * Client HTTP minimal.
 *
 * @param {{baseUrl?: string, token: string, timeoutMs?: number}} config
 */
function client({ baseUrl = BASE_DEFAUT, token, timeoutMs = 30000 } = {}) {
  if (!token) {
    throw new ErreurMecef(
      'Jeton e-MECeF absent. Il est délivré par la DGI après validation du ' +
        'parcours de test, et se renseigne dans les paramètres de la société.'
    );
  }

  async function appel(chemin, { methode = 'GET', corps = null } = {}) {
    const stop = new AbortController();
    const minuteur = setTimeout(() => stop.abort(), timeoutMs);
    let reponse;
    try {
      reponse = await fetch(`${baseUrl}${chemin}`, {
        method: methode,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(corps ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corps ? JSON.stringify(corps) : undefined,
        signal: stop.signal,
      });
    } catch (err) {
      // Un délai dépassé n'est PAS un échec : la facture a pu partir. On le dit
      // explicitement, pour que l'appelant n'ait pas le réflexe de réessayer.
      if (err.name === 'AbortError') {
        throw new ErreurMecef(
          `Pas de réponse de la DGI en ${Math.round(timeoutMs / 1000)} s. ` +
            'La facture a PEUT-ÊTRE été enregistrée : vérifiez son état avant de la renvoyer.',
          { code: 'DELAI_DEPASSE' }
        );
      }
      throw new ErreurMecef(`Plateforme DGI injoignable : ${err.message}`, { code: 'RESEAU' });
    } finally {
      clearTimeout(minuteur);
    }

    const texte = await reponse.text();
    let donnees = null;
    try {
      donnees = texte ? JSON.parse(texte) : null;
    } catch {
      donnees = { brut: texte.slice(0, 500) };
    }

    if (!reponse.ok) {
      if (reponse.status === 401 || reponse.status === 403) {
        throw new ErreurMecef(
          'Jeton e-MECeF refusé par la DGI. Il est peut-être expiré, ou établi ' +
            'pour un autre environnement que celui configuré.',
          { code: 'JETON_REFUSE', http: reponse.status, details: donnees }
        );
      }
      throw new ErreurMecef(message(donnees?.code, donnees?.errorDesc || donnees?.message), {
        code: donnees?.code ?? null,
        http: reponse.status,
        details: donnees,
      });
    }

    // La DGI répond 200 avec un code d'erreur applicatif dans le corps.
    if (donnees && donnees.code != null && donnees.code !== 0) {
      throw new ErreurMecef(message(donnees.code, donnees.errorDesc), {
        code: donnees.code,
        http: reponse.status,
        details: donnees,
      });
    }

    return donnees;
  }

  return {
    /** État de l'API — le contrôle de vie à faire avant d'y envoyer une pièce. */
    statut: () => appel('/invoice'),
    infos: () => appel('/info/status'),
    groupesTaxe: () => appel('/info/taxGroups'),
    typesFacture: () => appel('/info/invoiceTypes'),
    typesPaiement: () => appel('/info/paymentTypes'),

    creer: (charge) => appel('/invoice', { methode: 'POST', corps: charge }),
    confirmer: (uid) => appel(`/invoice/${encodeURIComponent(uid)}/confirm`, { methode: 'PUT' }),
    annuler: (uid) => appel(`/invoice/${encodeURIComponent(uid)}/cancel`, { methode: 'PUT' }),
    details: (uid) => appel(`/invoice/${encodeURIComponent(uid)}`),
  };
}

/**
 * Traduit une facture ParcAuto en charge utile DGI.
 *
 * FONCTION PURE, ET C'EST VOULU
 *
 * Elle ne lit pas la base et n'appelle pas le réseau : on peut donc vérifier
 * par des tests ce qui sera déclaré à l'administration, sans jeton et sans
 * toucher à la DGI. C'est la partie qu'on ne peut pas se permettre de deviner.
 *
 * UN VÉHICULE, UNE LIGNE
 *
 * La règle « une facture = un véhicule » du produit se traduit par un article
 * unique, désigné par sa marque, son modèle et son châssis. Le châssis EST la
 * désignation commerciale ici : c'est lui qui identifie le bien vendu.
 *
 * @param {object} f  facture et son contexte, déjà chargés
 * @returns {object}  charge utile prête à poster
 */
function construireCharge({
  ifu,
  typeFacture = 'FV',
  groupeTaxe,
  operateur,
  client: acheteur,
  vehicule,
  montantTotal,
  typePaiement = 'ESPECES',
}) {
  if (!ifu) {
    throw new ErreurMecef(
      'IFU de la société absent. Une facture normalisée sans IFU est refusée — ' +
        'renseignez-le dans Paramètres › Identité de la société.'
    );
  }
  if (!groupeTaxe) {
    throw new ErreurMecef(
      'Groupe de taxation non défini. Il détermine le taux de TVA appliqué et ' +
        'ne doit pas être deviné : relevez-le auprès de votre comptable.'
    );
  }

  const total = montant(montantTotal);
  if (total <= 0) {
    throw new ErreurMecef('Une facture normalisée doit porter un montant strictement positif.');
  }

  const designation =
    [vehicule?.brand, vehicule?.model].filter(Boolean).join(' ') || 'Véhicule';
  const nom = vehicule?.vin ? `${designation} — châssis ${vehicule.vin}` : designation;

  return {
    ifu: String(ifu).trim(),
    type: typeFacture,
    items: [
      {
        name: nom.slice(0, 255),
        price: total,
        quantity: 1,
        taxGroup: groupeTaxe,
      },
    ],
    client: acheteur?.name
      ? { name: String(acheteur.name).slice(0, 255), ifu: acheteur.ifu || undefined }
      : undefined,
    operator: { name: String(operateur || 'ParcAuto').slice(0, 120) },
    payment: [{ name: typePaiement, amount: total }],
  };
}

/**
 * Normalise, en deux temps, et rend ce qu'il faut conserver.
 *
 * `onUid` est appelé dès que l'identifiant est connu, AVANT la confirmation :
 * c'est le point où l'appelant le persiste. Sans ce rappel, une coupure entre
 * les deux appels perdrait la seule clé permettant de retrouver la facture
 * chez la DGI — et on ne saurait plus si elle a été déclarée.
 *
 * @returns {{uid: string, code: string, qrCode: string, total: number, brut: object}}
 */
async function normaliser(cfg, charge, onUid) {
  const api = client(cfg);

  const cree = await api.creer(charge);
  const uid = cree?.uid ?? cree?.invoice?.uid;
  if (!uid) {
    throw new ErreurMecef('La DGI n’a pas renvoyé d’identifiant de facture.', { details: cree });
  }
  if (typeof onUid === 'function') await onUid(uid, cree);

  const confirme = await api.confirmer(uid);
  const code = confirme?.codeMECeFDGI ?? confirme?.security?.codeMECeFDGI ?? null;
  const qrCode = confirme?.qrCode ?? confirme?.security?.qrCode ?? null;
  if (!code) {
    throw new ErreurMecef(
      'La DGI a confirmé sans renvoyer de code MECeF — la facture ne peut pas être ' +
        'considérée comme normalisée.',
      { details: confirme }
    );
  }

  return {
    uid,
    code,
    qrCode,
    total: Number(confirme?.total ?? cree?.total ?? charge.payment?.[0]?.amount ?? 0),
    brut: confirme,
  };
}

module.exports = {
  BASE_DEFAUT,
  CODES,
  ErreurMecef,
  montant,
  message,
  client,
  construireCharge,
  normaliser,
};
