const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db/pool');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TTL_MS        = 60 * 60 * 1000;      // 1h

const UserModel = {
  async create(email, password, role = 'client') {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3)
       RETURNING id, email, role, is_active, email_verified, created_at`,
      [email.toLowerCase().trim(), hash, role]
    );
    // No subscription rows are created here — SubscriptionModel treats a
    // missing row as "inactive" for both products, and a real row only
    // gets created once a payment actually activates one (see
    // SubscriptionModel.activate, which upserts on (user_id, product)).
    return rows[0];
  },

  async findByEmail(email) {
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, email, role, is_active, email_verified, created_at FROM users WHERE id = $1`, [id]
    );
    return rows[0] || null;
  },

  async verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
  },

  async setActive(id, isActive) {
    await pool.query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive, id]);
  },

  // Permanent delete — used by the admin dashboard's "remove user" action.
  // binance_keys, subscriptions, payments, trial_claims cascade via FK;
  // activity_log rows are kept but their user_id goes to NULL (ON DELETE
  // SET NULL) so the audit trail survives the account being removed.
  async remove(id) {
    const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    return rowCount > 0;
  },

  async updateLoginInfo(id, ip) {
    await pool.query(`UPDATE users SET last_login_at = now(), last_login_ip = $2 WHERE id = $1`, [id, ip]);
  },

  // ── Email verification ─────────────────────────────────────
  async setVerificationToken(id) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + VERIFICATION_TTL_MS);
    await pool.query(
      `UPDATE users SET verification_token = $2, verification_expires = $3 WHERE id = $1`,
      [id, token, expires]
    );
    return token;
  },

  async findByVerificationToken(token) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE verification_token = $1 AND verification_expires > now()`,
      [token]
    );
    return rows[0] || null;
  },

  async markVerified(id) {
    await pool.query(
      `UPDATE users SET email_verified = true, verification_token = NULL, verification_expires = NULL WHERE id = $1`,
      [id]
    );
  },

  // ── Forgot password ─────────────────────────────────────────
  async setResetToken(id) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TTL_MS);
    await pool.query(
      `UPDATE users SET reset_token = $2, reset_token_expires = $3 WHERE id = $1`,
      [id, token, expires]
    );
    return token;
  },

  async findByResetToken(token) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > now()`,
      [token]
    );
    return rows[0] || null;
  },

  async resetPassword(id, newPassword) {
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET password_hash = $2, reset_token = NULL, reset_token_expires = NULL WHERE id = $1`,
      [id, hash]
    );
  },

  // For the admin client list: users joined with both their subscription statuses.
  // For the admin client list: users joined with their bot subscription
  // (the only product now — plan determines pair-count tier), plus trial
  // usage and last-login info for the admin activity view.
  async listWithSubscriptions() {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.role, u.is_active, u.email_verified, u.created_at,
             u.last_login_at, u.last_login_ip,
             s.status AS bot_status, s.plan AS bot_plan, s.expires_at AS bot_expires_at,
             t.claimed_at AS trial_claimed_at, t.ip_address AS trial_ip
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.product = 'bot'
      LEFT JOIN trial_claims t ON t.user_id = u.id
      WHERE u.role = 'client'
      ORDER BY u.created_at DESC
    `);
    return rows;
  },
};

module.exports = { UserModel };
