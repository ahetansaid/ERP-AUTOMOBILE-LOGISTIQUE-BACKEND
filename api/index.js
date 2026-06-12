// Point d'entrée serverless Vercel.
// Vercel transforme ce fichier en fonction serverless ; il réutilise
// l'application Express définie dans src/index.js (qui n'appelle pas
// app.listen() quand process.env.VERCEL est présent).
module.exports = require('../src/index.js');
