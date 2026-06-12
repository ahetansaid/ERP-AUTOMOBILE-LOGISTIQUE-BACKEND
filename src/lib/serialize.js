/**
 * Helpers de sérialisation.
 *
 * Les anciennes routes utilisaient des requêtes SQL brutes (`SELECT *`) qui
 * renvoyaient des colonnes en snake_case directement consommées par le
 * frontend. Prisma, lui, expose les champs en camelCase (mappés vers les
 * colonnes snake_case via @map). Pour conserver le même contrat d'API après la
 * migration vers Prisma, on reconvertit les objets Prisma en snake_case.
 */

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}

/**
 * Vrai si la valeur est un objet "structurel" qu'on doit parcourir
 * (résultat Prisma = objet litéral simple). On NE parcourt PAS les Date ni
 * les Decimal de Prisma (instances de classe), qu'on laisse tels quels pour
 * que JSON.stringify les sérialise comme l'ancien driver mysql2 (Date → ISO,
 * Decimal → string).
 */
function isPlainRecord(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v.constructor === Object || v.constructor === undefined)
  );
}

/**
 * Convertit récursivement les clés d'un objet (ou tableau d'objets) de
 * camelCase vers snake_case.
 */
function toSnake(value) {
  if (Array.isArray(value)) {
    return value.map(toSnake);
  }
  if (isPlainRecord(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[camelToSnake(k)] = toSnake(v);
    }
    return out;
  }
  return value;
}

module.exports = { toSnake, camelToSnake };
