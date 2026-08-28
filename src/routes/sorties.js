/**
 * Les deux portes de sortie : atelier et livraison.
 *
 * DEUX VERBES PAR PORTE, ET C'EST TOUT
 *
 *   GET  …/etat/:vehicleId   ce que l'écran montre AVANT de cliquer
 *   POST …                   franchir
 *
 * Le GET n'est pas un confort : c'est lui qui rend la décision consciente. Il
 * énonce le solde, les réserves et ce qui manque, pour qu'on sache ce qu'on
 * signe. Un bouton qui ouvre sans rien dire produit exactement l'inverse de ce
 * qu'on cherche ici.
 *
 * PERMISSIONS
 *
 * La sortie d'atelier relève du module `workshop_quotes`, la livraison du
 * module `invoices` — ce sont les enveloppes qu'elles referment. Aucun droit
 * nouveau à distribuer : qui peut encaisser peut livrer, qui peut payer un
 * prestataire peut sortir le véhicule de son atelier.
 */

const express = require('express');
const { authorize } = require('../middleware/rbac');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { notify } = require('../services/notifications');
const {
  SORTIE_ATELIER,
  LIVRAISON_CLIENT,
  etatAtelier,
  etatLivraison,
  franchir,
} = require('../lib/sorties');

const router = express.Router();

const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;

/** Le véhicule appartient-il bien à la société courante ? */
async function vehiculeDuTenant(req, vehicleId) {
  if (!Number.isInteger(vehicleId)) return null;
  return prisma.vehicle.findFirst({
    where: { id: vehicleId, ...req.tenantWhere() },
    select: { id: true, vin: true, brand: true, model: true },
  });
}

/** Fabrique les deux routes d'une porte — la mécanique est la même. */
function monterPorte({ chemin, jalon, moduleRbac, etat, titreNotif, messageNotif }) {
  router.get(`/${chemin}/etat/:vehicleId`, authorize(moduleRbac, 'read'), async (req, res) => {
    try {
      const vehicleId = Number(req.params.vehicleId);
      if (!(await vehiculeDuTenant(req, vehicleId))) {
        return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
      }
      const resultat = await etat(vehicleId);
      return res.status(200).json(resultat);
    } catch (e) {
      console.error(`[sorties.${chemin}.etat]`, e);
      return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
    }
  });

  router.post(`/${chemin}`, authorize(moduleRbac, 'update'), async (req, res) => {
    try {
      const b = req.body || {};
      const vehicleId = Number(b.vehicleId ?? b.vehicle_id);
      const vehicule = await vehiculeDuTenant(req, vehicleId);
      if (!vehicule) {
        return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
      }

      const resultat = await franchir({
        vehicleId,
        jalon,
        date: b.date ?? b.dateArrival ?? b.date_arrival,
        docRef: b.docRef ?? b.doc_ref,
        motif: b.motif,
        companyId: req.companyId ?? null,
      });

      if (!resultat.ok) {
        const code = resultat.code === 'VEHICULE_INTROUVABLE' ? 404 : 409;
        return res.status(code).json({
          message: resultat.message,
          statusCode: code,
          code: resultat.code,
          etat: resultat.etat ?? null,
        });
      }

      const solde = Number(resultat.etape.soldeGele) || 0;
      notify({
        companyId: req.companyId ?? null,
        type: solde > 0 ? 'WARNING' : 'SUCCESS',
        title: titreNotif,
        message: messageNotif(vehicule, solde, resultat.etape),
        link: `/vehicules/${vehicleId}`,
        audience: 'admins',
      });

      return res.status(201).json({
        ...toSnake(resultat.etape),
        solde_gele: solde,
        reserves: resultat.etat.reserves,
      });
    } catch (e) {
      // Deux sorties simultanées sur le même véhicule : l'index unique en base
      // tranche, et il a raison — un doublon fausserait le solde figé.
      if (String(e?.code) === 'P2002') {
        return res.status(409).json({
          message: 'Cette sortie a déjà été enregistrée.',
          statusCode: 409,
          code: 'DEJA_FRANCHIE',
        });
      }
      console.error(`[sorties.${chemin}]`, e);
      return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
    }
  });
}

const designation = (v) =>
  [v.brand, v.model].filter(Boolean).join(' ') || `Véhicule #${v.id}`;

monterPorte({
  chemin: 'atelier',
  jalon: SORTIE_ATELIER,
  moduleRbac: 'workshop_quotes',
  etat: etatAtelier,
  titreNotif: "Sortie d'atelier",
  messageNotif: (v, solde) =>
    solde > 0
      ? `${designation(v)} sorti d'atelier avec ${fcfa(solde)} encore dus aux prestataires.`
      : `${designation(v)} sorti d'atelier, tous les devis soldés.`,
});

monterPorte({
  chemin: 'livraison',
  jalon: LIVRAISON_CLIENT,
  moduleRbac: 'invoices',
  etat: etatLivraison,
  titreNotif: 'Véhicule livré',
  messageNotif: (v, solde) =>
    solde > 0
      ? `${designation(v)} livré avec un solde impayé de ${fcfa(solde)}.`
      : `${designation(v)} livré, facture intégralement réglée.`,
});

module.exports = router;
