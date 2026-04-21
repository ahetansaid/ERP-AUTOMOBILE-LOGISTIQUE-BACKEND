const { escapeHtml } = require('../utils');

module.exports = function welcome({ userName, loginUrl }) {
  const name = userName ? escapeHtml(userName) : null;
  return {
    preheader: 'Bienvenue sur ParcAuto Manager.',
    title: 'Bienvenue sur ParcAuto Manager',
    body: `
      <p>${name ? `Bonjour ${name},` : 'Bonjour,'}</p>
      <p>Votre compte ParcAuto Manager est prêt. Vous pouvez dès maintenant vous connecter et commencer à gérer votre parc : achats, stock, facturation, trésorerie.</p>
      <p style="font-size:13px;color:#71717A;margin-top:16px;">Besoin d'aide pour démarrer ? Répondez simplement à ce message, notre équipe vous accompagne.</p>
    `,
    cta: { label: 'Accéder à mon espace', href: loginUrl },
  };
};
