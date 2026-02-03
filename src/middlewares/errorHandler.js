/**
 * Gestionnaire d'erreurs global — renvoie { message, statusCode } en JSON
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? 'Erreur interne serveur';
  res.status(statusCode).json({ message, statusCode });
}
