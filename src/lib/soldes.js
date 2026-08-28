/**
 * Soldes des deux enveloppes : la facture et le devis d'atelier.
 *
 * UN SEUL ENDROIT QUI RÉPOND « COMBIEN RESTE-T-IL »
 *
 * Le calcul était écrit six fois — dans la liste des factures, dans le détail,
 * dans la liste des reçus, dans le garde-fou de création de reçu, dans le PDF.
 * Cinq de ces six copies plafonnaient sur `vehicle.priceSale` au lieu de
 * `invoice.totalAmount`, avec deux conséquences mesurables :
 *
 *   · baisser le prix de vente après facturation changeait RÉTROACTIVEMENT le
 *     solde dû, donc le montant maximal d'un reçu ;
 *   · un véhicule sans prix de vente donnait un solde de 0, et sa facture
 *     n'acceptait plus aucun reçu.
 *
 * Une facture émise porte son propre montant, définitivement. Le prix de vente
 * du véhicule reste une donnée commerciale, il n'est plus une source de vérité
 * comptable.
 *
 * RIEN N'EST STOCKÉ
 *
 * Le montant payé est toujours la somme des reçus, jamais un compteur tenu à
 * jour — c'est la même discipline que le coût de revient, qui est la somme du
 * grand livre. Un compteur dérive dès le premier reçu supprimé ; une somme, non.
 */

const { prisma } = require('./prisma');

const nombre = (v) => (v == null ? 0 : Number(v));

/** Somme des reçus rattachés à une enveloppe. */
async function totalRegle(where) {
  const agg = await prisma.receipt.aggregate({ _sum: { amount: true }, where });
  return nombre(agg._sum.amount);
}

/**
 * Solde d'une facture.
 *
 * @param {{id: number, totalAmount: any}} facture — déjà chargée, pour éviter
 *   une requête de plus quand l'appelant la tient déjà.
 */
async function soldeFacture(facture) {
  const total = nombre(facture.totalAmount);
  const paye = await totalRegle({ invoiceId: facture.id });
  return { total, paye, restant: Math.max(0, total - paye), solde: total - paye };
}

/** Solde d'un devis d'atelier. Même forme, autre enveloppe. */
async function soldeDevis(devis) {
  const total = nombre(devis.amount);
  const paye = await totalRegle({ workshopQuoteId: devis.id });
  return { total, paye, restant: Math.max(0, total - paye), solde: total - paye };
}

/**
 * Statut d'une facture déduit de ses reçus.
 *
 * ANNULEE est un choix humain : on ne le remplace jamais. EN_RETARD n'est pas
 * posé ici — c'est un état de temps, pas de paiement, et la règle d'alerte
 * FACTURE_ECHUE le signale déjà sans figer quoi que ce soit en base.
 */
function statutSelonPaiement(total, paye, statutActuel) {
  if (statutActuel === 'ANNULEE') return 'ANNULEE';
  if (paye <= 0) return 'EMISE';
  if (paye >= total) return 'PAYEE';
  return 'PARTIELLEMENT_PAYEE';
}

/**
 * Recale le statut d'une facture après un mouvement de reçu.
 *
 * À appeler après CHAQUE création et CHAQUE suppression de reçu : sans quoi une
 * facture intégralement réglée reste affichée « émise », ce qui était le cas
 * avant — le statut n'était posé que par un PATCH manuel que personne ne faisait.
 */
async function recalerStatutFacture(invoiceId) {
  const facture = await prisma.invoice.findUnique({
    where: { id: Number(invoiceId) },
    select: { id: true, totalAmount: true, status: true },
  });
  if (!facture) return null;

  const { total, paye } = await soldeFacture(facture);
  const attendu = statutSelonPaiement(total, paye, facture.status);
  if (attendu === facture.status) return facture.status;

  await prisma.invoice.update({ where: { id: facture.id }, data: { status: attendu } });
  return attendu;
}

/**
 * Recale le statut d'un devis après un mouvement de reçu.
 *
 * Symétrique de la facture, avec une asymétrie assumée : un devis REFUSE ne
 * revient jamais, et un devis rouvert par la suppression d'un reçu repasse en
 * EN_COURS plutôt qu'en EN_ATTENTE — le travail, lui, a bien commencé.
 */
async function recalerStatutDevis(workshopQuoteId) {
  const devis = await prisma.workshopQuote.findUnique({
    where: { id: Number(workshopQuoteId) },
    select: { id: true, amount: true, status: true, closedAt: true },
  });
  if (!devis || devis.status === 'REFUSE') return devis?.status ?? null;

  const { total, paye } = await soldeDevis(devis);
  const solde = paye >= total && total > 0;

  if (solde && devis.status !== 'TERMINE') {
    await prisma.workshopQuote.update({
      where: { id: devis.id },
      data: { status: 'TERMINE', closedAt: devis.closedAt ?? new Date() },
    });
    return 'TERMINE';
  }
  if (!solde && devis.status === 'TERMINE') {
    // Un reçu supprimé rouvre le devis : le laisser « terminé » ferait croire
    // le prestataire payé alors qu'il ne l'est plus.
    await prisma.workshopQuote.update({
      where: { id: devis.id },
      data: { status: 'EN_COURS', closedAt: null },
    });
    return 'EN_COURS';
  }
  return devis.status;
}

module.exports = {
  totalRegle,
  soldeFacture,
  soldeDevis,
  statutSelonPaiement,
  recalerStatutFacture,
  recalerStatutDevis,
};
