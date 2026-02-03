/**
 * Crée l'utilisateur admin par défaut (mot de passe : Admin123!)
 * Exécuter après avoir appliqué sql/schema.sql
 * npx node scripts/seed-user.js
 */
import bcrypt from 'bcryptjs';
import pool from '../src/db.js';

const DEFAULT_EMAIL = 'admin@erp.bj';
const DEFAULT_PASSWORD = 'Admin123!';
const DEFAULT_ROLE = 'SUPER_ADMIN';

async function seed() {
  try {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await pool.execute(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES (?, ?, 'Admin', 'ERP', ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [DEFAULT_EMAIL, passwordHash, DEFAULT_ROLE]
    );
    console.log('Utilisateur créé/mis à jour :', DEFAULT_EMAIL, '| Mot de passe :', DEFAULT_PASSWORD);
  } catch (err) {
    console.error('Erreur seed:', err.message);
    process.exit(1);
  } finally {
    pool.end();
  }
}

seed();
