/**
 * Rapport d'anomalies de la reprise — deuxième des trois temps.
 *
 *     extract.py  →  tampon.json  →  report.js  →  load.js
 *
 * Ce script N'ÉCRIT RIEN, ni en base ni dans le tampon. Il lit, recalcule, et
 * dit ce que la reprise fera et ce qu'elle ne pourra pas faire. On le lit avant
 * de charger, parce que le grand livre est en écriture seule : un import fautif
 * ne se rattrape qu'en contre-passant ligne à ligne.
 *
 *     node scripts/import/report.js [scripts/import/tampon.json] [--json fichier]
 *
 * PRINCIPE — le total du classeur n'est jamais importé.
 *
 * L'engagement E1 dit que rien de calculable n'est saisi : le coût de revient
 * est une somme d'écritures, jamais un nombre recopié. La reprise importe donc
 * les COMPOSANTS (achat, transport, fret, dépotage, main d'œuvre, frais
 * connexes, réparations détaillées, IMV) et laisse la plateforme recalculer.
 *
 * La colonne « coût total » du classeur devient alors un CONTRÔLE : là où elle
 * s'écarte de la somme de ses propres composants, c'est le classeur qui se
 * contredit, pas la reprise qui se trompe. Ce rapport chiffre ces écarts.
 */

const fs = require('node:fs');
const path = require('node:path');
const { slugify, coreSlug, guessSpecialty } = require('../../src/lib/partners');

/* ── Cadre de lecture ─────────────────────────────────────────────────────── */

/**
 * Bande plausible du taux FCFA/USD.
 *
 * Le FCFA est arrimé à l'euro à 655,957. Le taux dollar en découle mécaniquement
 * par le cours EUR/USD : sur la période couverte par les classeurs, il ne peut
 * pas sortir de cette fourchette. Un taux en dehors n'est pas un taux négocié,
 * c'est une erreur de saisie.
 */
const TAUX_MIN = 550;
const TAUX_MAX = 700;

/** Au-delà, la marge n'est pas une marge : c'est un coût manquant. */
const MARGE_INVRAISEMBLABLE = 100;

const NIVEAUX = {
  BLOQUANT: 'BLOQUANT',
  ARBITRAGE: 'ARBITRAGE',
  SIGNALE: 'SIGNALE',
};

/* ── Outils ───────────────────────────────────────────────────────────────── */

const fcfa = (n) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} F`;

const nb = (n) => (n == null ? 0 : n);

/**
 * Clé de contrôle des VIN nord-américains (ISO 3779, position 9).
 *
 * Un VIN mal recopié désigne un véhicule introuvable : ni le vendeur, ni la
 * douane, ni l'atelier ne le reconnaîtront. La clé ne vaut que pour les VIN
 * commençant par 1, 4 ou 5 — les autres régions ne la renseignent pas.
 * Retourne null quand le contrôle ne s'applique pas.
 */
function vinValide(vin) {
  if (!vin || vin.length !== 17) return null;
  if (!/^[1-5]/.test(vin)) return null;
  if (/[IOQ]/.test(vin)) return false;

  const valeurs = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };
  const poids = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

  let somme = 0;
  for (let i = 0; i < 17; i += 1) {
    const c = vin[i];
    const v = /\d/.test(c) ? Number(c) : valeurs[c];
    if (v === undefined) return false;
    somme += v * poids[i];
  }
  const reste = somme % 11;
  const attendu = reste === 10 ? 'X' : String(reste);
  return vin[8] === attendu;
}

/**
 * Coût de revient recalculé à partir des seuls composants.
 * `null` quand un composant indispensable manque — on ne devine pas.
 */
function recalculer(v, taux) {
  if (taux == null) return null;
  const devise = [
    v.achat_devise,
    v.transport_devise,
    v.fret_devise,
    // La commission n'existe que sur une partie des feuilles, et sous trois
    // positions différentes. Une lecture par position l'attribuait au transport
    // ou la perdait : elle vaut 23 véhicules sur 61.
    v.commission_devise,
  ];
  if (devise.every((x) => x == null)) return null;
  const enDevise = devise.reduce((s, x) => s + nb(x), 0);
  return (
    enDevise * taux +
    nb(v.depotage) +
    nb(v.main_oeuvre) +
    nb(v.frais_connexe) +
    nb(v.reparation)
  );
}

/* ── Analyse ──────────────────────────────────────────────────────────────── */

function analyser(tampon) {
  const anomalies = [];
  const vehicules = [];
  const vus = new Map(); // VIN -> première occurrence

  const signaler = (niveau, code, cle, message, detail) =>
    anomalies.push({ niveau, code, cle, message, ...(detail ? { detail } : {}) });

  for (const conteneur of tampon.conteneurs) {
    const ref = conteneur.reference || conteneur.feuille;

    if (conteneur.blocs && !conteneur.blocs.repartition) {
      signaler(
        NIVEAUX.SIGNALE,
        'FEUILLE_SANS_REPARTITION',
        ref,
        'aucun bloc de répartition — ni coût total, ni prix de vente, ni IMV pour cette feuille'
      );
    }

    if (!conteneur.date) {
      signaler(
        NIVEAUX.SIGNALE,
        'CONTENEUR_SANS_DATE',
        ref,
        "aucune date d'arrivée dans le titre de la feuille"
      );
    }

    // Interventions rattachées, par VIN — elles alimentent le contrôle de la
    // colonne « réparation ».
    const parVin = new Map();
    for (const i of conteneur.interventions) {
      if (!i.vin) continue;
      if (!parVin.has(i.vin)) parVin.set(i.vin, []);
      parVin.get(i.vin).push(i);
    }
    const orphelines = conteneur.interventions.filter((i) => !i.vin);
    if (orphelines.length) {
      signaler(
        NIVEAUX.SIGNALE,
        'INTERVENTION_SANS_VEHICULE',
        ref,
        `${orphelines.length} intervention(s) sans châssis identifiable — ` +
          `${fcfa(orphelines.reduce((s, i) => s + nb(i.montant), 0))} non rattachables`,
        orphelines.map((i) => `${i.description || '?'} · ${i.prestataire} · ${fcfa(i.montant)}`)
      );
    }

    for (const v of conteneur.vehicules) {
      const cle = v.vin || `${ref} ligne ${v.ligne}`;
      const nom = `${v.vehicule || '?'} (${cle})`;

      /* — Bloquantes — */
      if (!v.vin || v.vin.length < 11) {
        signaler(NIVEAUX.BLOQUANT, 'VIN_ABSENT', cle, `châssis absent ou trop court — ${nom}`);
      } else if (vus.has(v.vin)) {
        signaler(
          NIVEAUX.BLOQUANT,
          'VIN_DUPLIQUE',
          v.vin,
          `châssis déjà vu sur ${vus.get(v.vin)} — un véhicule ne s'importe qu'une fois`
        );
      } else {
        vus.set(v.vin, ref);
      }

      const tauxCout = v.taux_bloc_cout;
      const tauxRepart = v.taux_bloc_repartition;
      const taux = tauxCout ?? tauxRepart;

      if (v.achat_devise == null) {
        signaler(NIVEAUX.BLOQUANT, 'ACHAT_ABSENT', cle, `prix d'achat absent — ${nom}`);
      }
      if (taux == null && v.achat_devise != null) {
        signaler(
          NIVEAUX.BLOQUANT,
          'TAUX_INTROUVABLE',
          cle,
          `aucun taux de conversion dans la feuille — ${nom} ne peut pas être converti en FCFA`
        );
      }

      /* — À arbitrer — */
      if (tauxCout != null && tauxRepart != null && tauxCout !== tauxRepart) {
        const ecart = Math.abs(
          (nb(v.achat_devise) +
            nb(v.transport_devise) +
            nb(v.fret_devise) +
            nb(v.commission_devise)) *
            (tauxCout - tauxRepart)
        );
        signaler(
          NIVEAUX.ARBITRAGE,
          'TAUX_DIVERGENTS',
          cle,
          `le même véhicule est converti à ${tauxCout} dans le bloc coût et à ` +
            `${tauxRepart} dans le bloc répartition — ${fcfa(ecart)} d'écart`
        );
      }
      for (const [bloc, t] of [['coût', tauxCout], ['répartition', tauxRepart]]) {
        if (t != null && (t < TAUX_MIN || t > TAUX_MAX)) {
          signaler(
            NIVEAUX.ARBITRAGE,
            'TAUX_HORS_BANDE',
            cle,
            `taux ${t} dans le bloc ${bloc} — hors de la fourchette ${TAUX_MIN}–${TAUX_MAX} ` +
              `imposée par la parité fixe FCFA/euro`
          );
        }
      }

      /* — Signalées — */
      const recalcule = recalculer(v, taux);
      if (recalcule != null && v.cout_total != null) {
        const delta = Math.round(v.cout_total - recalcule);
        if (Math.abs(delta) >= 1) {
          const explique = Math.abs(delta - nb(v.imv)) < 1 ? " — soit exactement l'IMV" : '';
          signaler(
            NIVEAUX.SIGNALE,
            'TOTAL_INCOHERENT',
            cle,
            `le total du classeur (${fcfa(v.cout_total)}) s'écarte de ${fcfa(Math.abs(delta))} ` +
              `de la somme de ses propres composants (${fcfa(recalcule)})${explique}`
          );
        }
      }

      const interventions = parVin.get(v.vin) || [];
      const sommeInterventions = interventions.reduce((s, i) => s + nb(i.montant), 0);
      if (interventions.length && v.reparation != null) {
        const delta = Math.round(v.reparation - sommeInterventions);
        if (Math.abs(delta) >= 1) {
          signaler(
            NIVEAUX.SIGNALE,
            'REPARATION_INCOHERENTE',
            cle,
            `colonne réparation ${fcfa(v.reparation)} contre ${fcfa(sommeInterventions)} ` +
              `détaillés en ${interventions.length} intervention(s) — ${fcfa(Math.abs(delta))} d'écart`
          );
        }
      } else if (!interventions.length && nb(v.reparation) > 0) {
        signaler(
          NIVEAUX.SIGNALE,
          'REPARATION_SANS_DETAIL',
          cle,
          `${fcfa(v.reparation)} de réparation sans aucune intervention détaillée`
        );
      }

      // Contrôles internes au classeur : le bloc de répartition recopie des
      // sous-totaux que le bloc du milieu et celui du haut ont déjà calculés.
      // Là où les deux ne concordent pas, une des deux saisies a vieilli.
      if (v.manutention_repartie != null) {
        const attendu = nb(v.depotage) + nb(v.main_oeuvre) + nb(v.frais_connexe);
        const delta = Math.round(v.manutention_repartie - attendu);
        if (attendu > 0 && Math.abs(delta) >= 1) {
          signaler(
            NIVEAUX.SIGNALE,
            'MANUTENTION_DISCORDANTE',
            cle,
            `le bloc répartition retient ${fcfa(v.manutention_repartie)} de manutention, ` +
              `le bloc de détail en totalise ${fcfa(attendu)}`
          );
        }
      }
      if (v.logistique_repartie != null && taux != null) {
        const attendu =
          (nb(v.transport_devise) + nb(v.fret_devise) + nb(v.commission_devise)) * taux;
        const delta = Math.round(v.logistique_repartie - attendu);
        if (attendu > 0 && Math.abs(delta) >= 1) {
          signaler(
            NIVEAUX.SIGNALE,
            'LOGISTIQUE_DISCORDANTE',
            cle,
            `le bloc répartition retient ${fcfa(v.logistique_repartie)} de logistique, ` +
              `les composants en devise au taux ${taux} en donnent ${fcfa(attendu)}`
          );
        }
      }

      const manquants = [
        v.depotage == null && 'dépotage',
        v.main_oeuvre == null && "main d'œuvre",
        v.frais_connexe == null && 'frais connexes',
        v.fret_devise == null && 'fret',
      ].filter(Boolean);
      if (manquants.length) {
        signaler(
          NIVEAUX.SIGNALE,
          'COUT_INCOMPLET',
          cle,
          `composant(s) absent(s) : ${manquants.join(', ')} — le coût de revient sera sous-estimé`
        );
      }

      const cleVin = vinValide(v.vin);
      if (cleVin === false) {
        signaler(
          NIVEAUX.SIGNALE,
          'VIN_CLE_FAUSSE',
          v.vin,
          `clé de contrôle ISO 3779 incorrecte — châssis probablement mal recopié`
        );
      }

      const cout = recalcule ?? v.cout_total;
      if (v.prix_vente != null && cout) {
        const marge = ((v.prix_vente - cout) / cout) * 100;
        if (marge < 0) {
          signaler(
            NIVEAUX.SIGNALE,
            'MARGE_NEGATIVE',
            cle,
            `vendu ${fcfa(v.prix_vente)} pour un coût de ${fcfa(cout)} — perte de ${fcfa(cout - v.prix_vente)}`
          );
        } else if (marge > MARGE_INVRAISEMBLABLE) {
          signaler(
            NIVEAUX.SIGNALE,
            'MARGE_INVRAISEMBLABLE',
            cle,
            `marge de ${marge.toFixed(0)} % — un coût manque plus probablement qu'une affaire exceptionnelle`
          );
        }
      }

      vehicules.push({
        conteneur: ref,
        feuille: conteneur.feuille,
        vin: v.vin,
        vehicule: v.vehicule,
        annee: v.annee,
        atelier: v.atelier,
        taux,
        coutRecalcule: recalcule,
        coutClasseur: v.cout_total,
        prixVente: v.prix_vente,
        interventions: interventions.length,
        importable: Boolean(v.vin && v.vin.length >= 11 && v.achat_devise != null && taux != null),
        composants: {
          ACHAT: v.achat_devise != null && taux ? v.achat_devise * taux : null,
          TRANSPORT_INTERNE: v.transport_devise != null && taux ? v.transport_devise * taux : null,
          FRET: v.fret_devise != null && taux ? v.fret_devise * taux : null,
          COMMISSION: v.commission_devise != null && taux ? v.commission_devise * taux : null,
          DEPOTAGE: v.depotage,
          MAIN_OEUVRE: v.main_oeuvre,
          FRAIS_CONNEXE: v.frais_connexe,
          IMV: v.imv,
        },
        // La préparation ne suit pas le sort des autres composants : elle est
        // reprise même quand le prix d'achat manque. Ce qu'on sait avoir
        // dépensé en atelier ne se perd pas parce qu'on ignore le prix d'achat.
        // Sans détail, la colonne est reprise en une écriture unique.
        preparation: interventions.length
          ? { lignes: interventions.length, montant: sommeInterventions }
          : nb(v.reparation) > 0
            ? { lignes: 1, montant: v.reparation }
            : { lignes: 0, montant: 0 },
      });
    }
  }

  return { anomalies, vehicules, vus };
}

/* ── Tiers ────────────────────────────────────────────────────────────────── */

/**
 * Regroupement des prestataires par la MÊME fonction que celle qu'utilisera
 * l'import. Le rapport montre donc ce qui sera réellement fait, pas une
 * approximation refaite pour l'occasion.
 */
function analyserTiers(tampon) {
  const parSlug = new Map();
  for (const c of tampon.conteneurs) {
    for (const i of c.interventions) {
      if (!i.prestataire) continue;
      const slug = slugify(i.prestataire);
      if (!slug) continue;
      if (!parSlug.has(slug)) {
        parSlug.set(slug, { slug, graphies: new Set(), montant: 0, lignes: 0 });
      }
      const t = parSlug.get(slug);
      t.graphies.add(i.prestataire);
      t.montant += nb(i.montant);
      t.lignes += 1;
    }
  }

  const tiers = [...parSlug.values()].map((t) => ({
    ...t,
    graphies: [...t.graphies],
    metier: guessSpecialty([...t.graphies][0]),
  }));

  // Rapprochements possibles : même noyau une fois les mots de parc retirés.
  // Un noyau vide ne rapproche rien — « Peintre EURO » et « Peintre USA » se
  // réduisent tous deux à rien du tout, ce qui ne prouve pas qu'il s'agit de la
  // même personne.
  const parNoyau = new Map();
  for (const t of tiers) {
    const noyau = coreSlug(t.slug);
    if (!noyau) continue;
    if (!parNoyau.has(noyau)) parNoyau.set(noyau, []);
    parNoyau.get(noyau).push(t);
  }
  const fusions = [...parNoyau.entries()]
    .filter(([, l]) => l.length > 1)
    .map(([noyau, l]) => ({ noyau, tiers: l }));

  return {
    tiers: tiers.sort((a, b) => b.montant - a.montant),
    fusions,
    voisins: graphiesProches(tiers, fusions),
  };
}

/** Distance d'édition, bornée : au-delà du seuil on abandonne le calcul. */
function distance(a, b, seuil) {
  if (Math.abs(a.length - b.length) > seuil) return seuil + 1;
  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const courante = [i];
    for (let j = 1; j <= b.length; j += 1) {
      courante[j] = Math.min(
        precedente[j] + 1,
        courante[j - 1] + 1,
        precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    if (Math.min(...courante) > seuil) return seuil + 1;
    precedente = courante;
  }
  return precedente[b.length];
}

/** Longueur du préfixe identique à deux chaînes. */
function prefixeCommun(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * Graphies que le slug ne rapproche pas mais qui désignent visiblement la même
 * personne : « Dieudonné », « Dieudoné », « Dieudonnée ». Le slug les distingue
 * — ce sont des orthographes différentes, pas des accents — et elles se
 * retrouveraient en trois tiers pour un seul soudeur.
 *
 * Proposé seulement : rien ne dit qu'il n'existe pas deux Dieudonné.
 */
function graphiesProches(tiers, fusions) {
  const dejaGroupes = new Set(fusions.flatMap((f) => f.tiers.map((t) => t.slug)));
  const SEUIL = 2;
  const groupes = [];
  const pris = new Set();

  for (let i = 0; i < tiers.length; i += 1) {
    if (pris.has(tiers[i].slug) || dejaGroupes.has(tiers[i].slug)) continue;
    const groupe = [tiers[i]];
    for (let j = i + 1; j < tiers.length; j += 1) {
      if (pris.has(tiers[j].slug) || dejaGroupes.has(tiers[j].slug)) continue;
      // Les noms courts sont exclus : à trois lettres, deux substitutions
      // rapprochent n'importe quoi.
      if (Math.min(tiers[i].slug.length, tiers[j].slug.length) < 6) continue;
      // Un préfixe commun est exigé : sans lui, « samiou » et « salisou » sont
      // à deux substitutions l'un de l'autre et seraient rapprochés à tort.
      // Les orthographes d'un même nom divergent vers la fin, pas au début.
      if (prefixeCommun(tiers[i].slug, tiers[j].slug) < 4) continue;
      if (distance(tiers[i].slug, tiers[j].slug, SEUIL) <= SEUIL) {
        groupe.push(tiers[j]);
        pris.add(tiers[j].slug);
      }
    }
    if (groupe.length > 1) {
      pris.add(tiers[i].slug);
      groupes.push(groupe);
    }
  }
  return groupes;
}

/* ── Pièces détachées ─────────────────────────────────────────────────────── */

function analyserPieces(tampon, vus) {
  const resultat = { rattachees: [], orphelines: [], vinsInconnus: [] };
  const feuilles = new Set(tampon.conteneurs.map((c) => c.feuille));

  for (const [nom, bloc] of Object.entries(tampon.pieces_detachees || {})) {
    const cible = feuilles.has(nom) ? nom : null;
    (cible ? resultat.rattachees : resultat.orphelines).push({
      feuille: nom,
      total: bloc.total,
      lignes: bloc.lignes.length,
    });
    for (const l of bloc.lignes) {
      if (l.vin && l.vin.length >= 11 && !vus.has(l.vin)) {
        resultat.vinsInconnus.push({ feuille: nom, vin: l.vin, montant: l.montant });
      }
    }
  }
  return resultat;
}

/* ── Restitution ──────────────────────────────────────────────────────────── */

function titre(t) {
  console.log(`\n${t}`);
  console.log('─'.repeat(t.length));
}

function rendre({ anomalies, vehicules, vus }, tiers, pieces, tampon) {
  const parNiveau = (n) => anomalies.filter((a) => a.niveau === n);
  const grouper = (liste) => {
    const m = new Map();
    for (const a of liste) {
      if (!m.has(a.code)) m.set(a.code, []);
      m.get(a.code).push(a);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  console.log('═'.repeat(78));
  console.log("RAPPORT D'ANOMALIES — REPRISE DE L'HISTORIQUE");
  console.log('═'.repeat(78));
  console.log(`Source   : ${tampon.source}`);
  console.log(`Lecture  : ${new Date().toLocaleString('fr-FR')}`);
  console.log('Aucune écriture — ni en base, ni dans le tampon.');

  /* Volumétrie */
  titre('1. CE QUE CONTIENT LE TAMPON');
  const importables = vehicules.filter((v) => v.importable);
  const interventions = tampon.conteneurs.reduce((s, c) => s + c.interventions.length, 0);
  console.log(`  conteneurs        ${String(tampon.conteneurs.length).padStart(5)}`);
  console.log(`  véhicules         ${String(vehicules.length).padStart(5)}  dont ${importables.length} importables en l'état`);
  console.log(`  châssis distincts ${String(vus.size).padStart(5)}`);
  console.log(`  interventions     ${String(interventions).padStart(5)}`);
  console.log(`  prestataires      ${String(tiers.tiers.length).padStart(5)}  après regroupement des graphies`);

  const vendus = vehicules.filter((v) => v.prixVente != null);
  console.log(
    `\n  ${vendus.length} véhicules portent un prix de vente, ${vehicules.length - vendus.length} n'en portent pas.`
  );

  /* Anomalies */
  const rendreGroupe = (liste, intro) => {
    if (!liste.length) {
      console.log('  aucune.');
      return;
    }
    console.log(intro);
    for (const [code, items] of grouper(liste)) {
      console.log(`\n  ▸ ${code} — ${items.length} cas`);
      for (const a of items.slice(0, 8)) {
        console.log(`      ${String(a.cle).padEnd(20)} ${a.message}`);
        for (const d of (a.detail || []).slice(0, 4)) console.log(`        · ${d}`);
      }
      if (items.length > 8) console.log(`      … et ${items.length - 8} autres`);
    }
  };

  titre('2. BLOQUANTES — ces véhicules ne seront pas écrits');
  rendreGroupe(
    parNiveau(NIVEAUX.BLOQUANT),
    "  Le chargeur les laissera de côté et le dira. Rien d'incomplet ne part en base."
  );

  titre('3. À ARBITRER — une décision, et toutes les lignes suivent');
  rendreGroupe(
    parNiveau(NIVEAUX.ARBITRAGE),
    '  Ces cas ne sont pas des erreurs de lecture : le classeur se contredit lui-même.\n' +
      '  Le chargeur applique la règle que vous fixez, la même partout, et la trace.'
  );

  titre('4. SIGNALÉES — importables, mais le classeur ne se retrouvera pas');
  rendreGroupe(
    parNiveau(NIVEAUX.SIGNALE),
    "  La reprise recalcule le coût depuis ses composants. Là où le total du\n" +
      '  classeur diffère, c\'est lui qui se contredit — la plateforme affichera le\n' +
      '  montant recalculé, et ces écarts expliqueront la différence au client.'
  );

  /* Tiers */
  titre('5. TIERS — ce que le regroupement fera');
  console.log(`  ${tiers.tiers.length} prestataires distincts après convergence des graphies.\n`);
  for (const t of tiers.tiers.slice(0, 12)) {
    const alias = t.graphies.length > 1 ? `  ← ${t.graphies.join(' / ')}` : '';
    console.log(
      `    ${t.graphies[0].padEnd(24)} ${String(t.lignes).padStart(3)} ligne(s)  ` +
        `${fcfa(t.montant).padStart(14)}  ${(t.metier || '—').padEnd(12)}${alias}`
    );
  }
  if (tiers.tiers.length > 12) console.log(`    … et ${tiers.tiers.length - 12} autres`);

  if (tiers.fusions.length) {
    console.log('\n  Rapprochements PROPOSÉS, jamais appliqués automatiquement :');
    for (const f of tiers.fusions) {
      console.log(`    « ${f.noyau} » : ${f.tiers.map((t) => t.graphies[0]).join('  ·  ')}`);
    }
    console.log(
      "\n    Les suffixes de parc EURO/USA sont conservés : on ne sait pas, depuis\n" +
        '    le classeur seul, s\'il s\'agit d\'une personne sur deux parcs ou de deux\n' +
        '    homonymes. La fusion reste un geste humain.'
    );
  }

  if (tiers.voisins.length) {
    console.log('\n  Orthographes voisines — probablement la même personne :');
    for (const g of tiers.voisins) {
      const total = g.reduce((s, t) => s + t.montant, 0);
      console.log(
        `    ${g.map((t) => t.graphies[0]).join('  ·  ')}` +
          `   →  ${g.length} tiers pour ${fcfa(total)}`
      );
    }
  }

  /* Pièces détachées */
  titre('6. PIÈCES DÉTACHÉES — second registre');
  const total = (l) => l.reduce((s, x) => s + x.total, 0);
  console.log(
    `  ${pieces.rattachees.length} feuille(s) rattachée(s) à un conteneur connu — ${fcfa(total(pieces.rattachees))}`
  );
  console.log(
    `  ${pieces.orphelines.length} feuille(s) sans conteneur correspondant — ${fcfa(total(pieces.orphelines))}`
  );
  for (const o of pieces.orphelines) {
    console.log(`      ${o.feuille.padEnd(20)} ${o.lignes} ligne(s)  ${fcfa(o.total)}`);
  }
  if (pieces.vinsInconnus.length) {
    console.log(
      `\n  ${pieces.vinsInconnus.length} ligne(s) désignent un châssis absent du costing — ` +
        `${fcfa(pieces.vinsInconnus.reduce((s, x) => s + nb(x.montant), 0))}`
    );
  }

  /* Projection */
  titre('7. CE QUE LA REPRISE ÉCRIRA');
  const parNature = {};
  const ajouter = (type, lignes, montant) => {
    if (!montant) return;
    parNature[type] = parNature[type] || { lignes: 0, montant: 0 };
    parNature[type].lignes += lignes;
    parNature[type].montant += montant;
  };
  for (const v of importables) {
    for (const [type, montant] of Object.entries(v.composants)) ajouter(type, 1, montant);
  }
  // La préparation est reprise sur TOUS les véhicules, y compris ceux dont le
  // prix d'achat manque — et à raison d'une écriture par intervention, ce qui
  // conserve le prestataire et le motif. Cette projection est donc exactement
  // ce que le chargeur écrira.
  for (const v of vehicules) ajouter('PREPARATION', v.preparation.lignes, v.preparation.montant);

  console.log(`  ${importables.length} véhicules chiffrés sur ${vehicules.length} repris :\n`);
  let cumul = 0;
  for (const [type, v] of Object.entries(parNature).sort((a, b) => b[1].montant - a[1].montant)) {
    cumul += v.montant;
    console.log(`    ${type.padEnd(20)} ${String(v.lignes).padStart(3)} écriture(s)  ${fcfa(v.montant).padStart(16)}`);
  }
  console.log(`    ${''.padEnd(20)} ${''.padStart(3)}                ${'─'.repeat(16)}`);
  console.log(`    ${'TOTAL'.padEnd(20)} ${String(Object.values(parNature).reduce((s, v) => s + v.lignes, 0)).padStart(3)} écritures    ${fcfa(cumul).padStart(16)}`);
  console.log(
    '\n  Toutes portent le véhicule en axe analytique. Aucune ne porte de compte de\n' +
      '  trésorerie : la reprise reconstitue des COÛTS, pas des décaissements. La\n' +
      '  caisse se reprend séparément, à partir de la date de coupure.'
  );

  /* Verdict */
  titre('8. VERDICT');
  const b = parNiveau(NIVEAUX.BLOQUANT).length;
  const a = parNiveau(NIVEAUX.ARBITRAGE).length;
  const s = parNiveau(NIVEAUX.SIGNALE).length;
  console.log(`  ${b} bloquantes · ${a} à arbitrer · ${s} signalées`);
  console.log(
    `\n  ${importables.length} véhicules sur ${vehicules.length} peuvent être écrits en l'état.`
  );
  if (a > 0) {
    console.log(
      '\n  Les points à arbitrer ne bloquent pas le chargement : le chargeur a une\n' +
        '  règle par défaut pour chacun, et il la journalise. Mais elle vous engage,\n' +
        '  donc lisez la section 3 avant de lancer.'
    );
  }
  console.log('\n  Suite : node scripts/import/load.js   (à blanc par défaut)');
  console.log('═'.repeat(78));

  return { bloquantes: b, arbitrages: a, signalees: s, importables: importables.length };
}

/* ── Entrée ───────────────────────────────────────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const iJson = args.indexOf('--json');
  const sortieJson = iJson >= 0 ? args[iJson + 1] : null;
  const chemin =
    args.find((a) => !a.startsWith('--') && a !== sortieJson) ||
    path.join(__dirname, 'tampon.json');

  if (!fs.existsSync(chemin)) {
    console.error(
      `Tampon introuvable : ${chemin}\n` +
        'Produisez-le d\'abord :\n' +
        '  python scripts/import/extract.py "D:/Documents/Park auto" scripts/import/tampon.json'
    );
    process.exit(1);
  }

  const tampon = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  const analyse = analyser(tampon);
  const tiers = analyserTiers(tampon);
  const pieces = analyserPieces(tampon, analyse.vus);
  const resume = rendre(analyse, tiers, pieces, tampon);

  if (sortieJson) {
    fs.writeFileSync(
      sortieJson,
      JSON.stringify(
        {
          source: tampon.source,
          resume,
          anomalies: analyse.anomalies,
          vehicules: analyse.vehicules,
          tiers: tiers.tiers,
          fusionsProposees: tiers.fusions,
          pieces,
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`\nDétail complet écrit dans ${sortieJson}`);
  }
}

module.exports = { vinValide, recalculer, analyser, TAUX_MIN, TAUX_MAX };

if (require.main === module) main();
