const { escapeHtml } = require('../utils');

module.exports = function resetPassword({ userName, resetUrl, expiresInMinutes }) {
  const name = userName ? escapeHtml(userName) : null;
  return {
    preheader: 'Lien sécurisé pour définir un nouveau mot de passe.',
    title: 'Réinitialisation du mot de passe',
    body: `
      <p>${name ? `Bonjour ${name},` : 'Bonjour,'}</p>
      <p>Vous avez demandé à réinitialiser votre mot de passe ParcAuto Manager. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.</p>
      <p style="font-size:13px;color:#71717A;margin-top:16px;">Ce lien est valable ${expiresInMinutes || 60} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message — votre mot de passe actuel reste inchangé.</p>
    `,
    cta: { label: 'Définir un nouveau mot de passe', href: resetUrl },
    text: [
      name ? `Bonjour ${name},` : 'Bonjour,',
      '',
      'Vous avez demandé à réinitialiser votre mot de passe ParcAuto Manager.',
      `Ouvrez ce lien pour choisir un nouveau mot de passe (valide ${expiresInMinutes || 60} min) :`,
      resetUrl,
      '',
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    ].join('\n'),
  };
};
