/**
 * Lecture et écriture de CSV, sans dépendance.
 *
 * POURQUOI PAS UNE BIBLIOTHÈQUE
 *
 * Ce projet vient de retirer douze vulnérabilités venues de dépendances
 * transitives. Un analyseur CSV correct tient en cent lignes vérifiables ; en
 * ajouter une de plus pour ça se paie au prochain audit.
 *
 * LE SÉPARATEUR EST LE POINT-VIRGULE
 *
 * Excel en français lit le CSV avec le séparateur de liste du système, qui est
 * le point-virgule. Un fichier séparé par des virgules s'ouvre en une seule
 * colonne, et l'utilisateur conclut que l'export est cassé. On écrit donc en
 * point-virgule, et on ACCEPTE les deux en lecture — le fichier peut venir
 * d'ailleurs.
 *
 * LA MARQUE D'ORDRE D'OCTETS EST OBLIGATOIRE
 *
 * Sans elle, Excel lit l'UTF-8 comme du Latin-1 : « Dépotage » devient
 * « DÃ©potage ». Trois octets en tête du fichier suffisent à l'éviter.
 */

const BOM = '﻿';

/** Devine le séparateur d'après la première ligne. */
function devinerSeparateur(texte) {
  const premiere = String(texte).split(/\r?\n/, 1)[0] || '';
  const pv = (premiere.match(/;/g) || []).length;
  const vg = (premiere.match(/,/g) || []).length;
  const tab = (premiere.match(/\t/g) || []).length;
  if (tab > pv && tab > vg) return '\t';
  return vg > pv ? ',' : ';';
}

/**
 * Analyse un CSV en tableau d'objets, clés = en-têtes.
 *
 * Gère les champs entre guillemets, les guillemets doublés et les retours à la
 * ligne À L'INTÉRIEUR d'un champ — un libellé de dépense saisi sur deux lignes
 * dans Excel produit exactement ça, et un découpage naïf par ligne le casserait
 * en silence.
 */
function analyser(texte, options = {}) {
  let src = String(texte || '');
  if (src.startsWith(BOM)) src = src.slice(1);
  if (!src.trim()) return { entetes: [], lignes: [] };

  const sep = options.separateur || devinerSeparateur(src);

  const cellules = [];
  let champ = '';
  let ligne = [];
  let dansGuillemets = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];

    if (dansGuillemets) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          champ += '"';
          i += 1;
        } else {
          dansGuillemets = false;
        }
      } else {
        champ += c;
      }
      continue;
    }

    if (c === '"') {
      dansGuillemets = true;
    } else if (c === sep) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n') {
      ligne.push(champ);
      cellules.push(ligne);
      ligne = [];
      champ = '';
    } else if (c === '\r') {
      // Ignoré : le saut de ligne est porté par \n.
    } else {
      champ += c;
    }
  }
  // Dernière cellule, si le fichier ne finit pas par un saut de ligne.
  if (champ !== '' || ligne.length) {
    ligne.push(champ);
    cellules.push(ligne);
  }

  const brutes = cellules.filter((l) => l.some((c) => String(c).trim() !== ''));
  if (!brutes.length) return { entetes: [], lignes: [] };

  const entetes = brutes[0].map((h) => String(h).trim());
  const lignes = brutes.slice(1).map((cols, index) => {
    const obj = {};
    entetes.forEach((h, i) => {
      obj[h] = (cols[i] ?? '').trim();
    });
    // Le numéro de ligne du FICHIER, en-tête comprise : c'est ce que
    // l'utilisateur voit dans Excel, et c'est ce qu'un message d'erreur doit
    // citer pour être utilisable.
    obj.__ligne = index + 2;
    return obj;
  });

  return { entetes, lignes, separateur: sep };
}

/** Échappe une valeur pour le CSV. */
function echapper(valeur, sep) {
  if (valeur === null || valeur === undefined) return '';
  const s = String(valeur);
  if (s.includes('"') || s.includes(sep) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Sérialise des objets en CSV.
 *
 * @param {object[]} lignes
 * @param {string[]} colonnes ordre imposé — l'ordre des clés d'un objet n'est
 *   pas un contrat, et une colonne qui se déplace d'un export à l'autre rend le
 *   fichier impossible à comparer.
 */
function serialiser(lignes, colonnes, options = {}) {
  const sep = options.separateur || ';';
  const sortie = [colonnes.map((c) => echapper(c, sep)).join(sep)];
  for (const l of lignes) {
    sortie.push(colonnes.map((c) => echapper(l[c], sep)).join(sep));
  }
  // CRLF : c'est ce qu'attend Excel sous Windows.
  return BOM + sortie.join('\r\n') + '\r\n';
}

/** En-têtes HTTP d'un téléchargement CSV. */
function entetesTelechargement(res, nomFichier) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(nomFichier)}"`
  );
}

module.exports = { analyser, serialiser, echapper, devinerSeparateur, entetesTelechargement, BOM };
