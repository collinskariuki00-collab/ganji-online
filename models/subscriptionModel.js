const { pool } = require('../db/pool');

const SubscriptionModel = {
  async get(userId, product) {
    const { rows } = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND product = $2`, [userId, product]
    );
    return rows[0] || null;
  },

  async getAll(userId) {
    const { rows } = await pool.query(`SELECT * FROM subscriptions WHERE user_id = $1`, [userId]);
    return rows;
  },

  _isActive(row) {
    return !!(row && row.status === 'active' && row.expires_at && new Date(row.expires_at) > new Date());
  },

  // Bot access is now the only product — kept as a distinct name from
  // get()/activate() for read clarity at call sites (routes, botManager).
  async hasBotAccess(userId) {
    return this._isActive(await this.get(userId, 'bot'));
  },

  // Alias kept for any code that still asks about "signals access" —
  // scanning/signal generation is bundled into the single 'bot' product now,
  // there's no separate signals-only tier anymore.
  async hasSignalsAccess(userId) {
    return this.hasBotAccess(userId);
  },

  // Returns the plan name ('monthly' | 'daily') of the user's currently active bot subscription, or null if inactive.
  // Used to enforce each plan's pair-count cap in Settings.
  async getActivePlanName(userId) {
    const row = await this.get(userId, 'bot');
    return this._isActive(row) ? row.plan : null;
  },

  // Extends from "now" or from the current expiry if still active, whichever is later,
  // so paying early stacks time rather than wasting it.
  async activate(userId, product, plan, hours) {
    const current = await this.get(userId, product);
    const base = this._isActive(current) ? new Date(current.expires_at) : new Date();
    const expiresAt = new Date(base.getTime() + hours * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO subscriptions (user_id, product, status, plan, expires_at, updated_at)
       VALUES ($1, $2, 'active', $3, $4, now())
       ON CONFLICT (user_id, product) DO UPDATE
       SET status = 'active', plan = $3, expires_at = $4, updated_at = now()`,
      [userId, product, plan, expiresAt]
    );
    return this.get(userId, product);
  },

  async expireStale() {
    await pool.query(
      `UPDATE subscriptions SET status = 'expired', updated_at = now()
       WHERE status = 'active' AND expires_at < now()`
    );
  },
};

module.exports = { SubscriptionModel };
