-- ============================================================================
-- Nature REGLEMENT
--
-- La vente est reconnue à l'émission de la facture (VENTE). L'encaissement qui
-- suit déplace de la trésorerie sans créer de produit supplémentaire : sans
-- cette nature distincte, une vente facturée puis encaissée apparaîtrait deux
-- fois dans le chiffre d'affaires.
--
-- REGLEMENT est traité comme un mouvement de bilan (voir OFF_RESULT_NATURES
-- dans src/lib/ledger.js) : il touche le solde de caisse, jamais le résultat.
-- ============================================================================

ALTER TYPE "EntryNature" ADD VALUE IF NOT EXISTS 'REGLEMENT' AFTER 'VENTE';
