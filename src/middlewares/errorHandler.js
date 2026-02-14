/**
 * Gestionnaire d'erreurs global — renvoie { message, statusCode } en JSON
 * En 500, inclut le message MySQL (ex. "Unknown column") pour faciliter le debug.
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode ?? 500;
  let message = err.message ?? 'Erreur interne serveur';
  if (statusCode === 500 && err.code && typeof err.code === 'string' && (err.code.startsWith('ER_') || err.sqlMessage)) {
    message = err.sqlMessage || err.message;
  }
  res.status(statusCode).json({ message, statusCode });
}
