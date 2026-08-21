const { pool } = require('../db/pool');

const PaymentModel = {
  async create(userId, product, plan, method, amount, currency, reference = null) {
    const { rows } = await pool.query(
      `INSERT INTO payments (user_id, product, plan, method, amount, currency, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, product, plan, method, amount, currency, reference]
    );
    return rows[0];
  },

  async markCompleted(id, rawCallback = null) {
    const { rows } = await pool.query(
      `UPDATE payments SET status = 'completed', raw_callback = $2 WHERE id = $1 RETURNING *`,
      [id, rawCallback]
    );
    return rows[0];
  },

  async markFailed(id, rawCallback = null) {
    const { rows } = await pool.query(
      `UPDATE payments SET status = 'failed', raw_callback = $2 WHERE id = $1 RETURNING *`,
      [id, rawCallback]
    );
    return rows[0];
  },

  async findByReference(reference) {
    const { rows } = await pool.query(`SELECT * FROM payments WHERE reference = $1`, [reference]);
    return rows[0] || null;
  },

  async setReference(id, reference) {
    const { rows } = await pool.query(
      `UPDATE payments SET reference = $2 WHERE id = $1 RETURNING *`,
      [id, reference]
    );
    return rows[0];
  },

  async listForUser(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC`, [userId]
    );
    return rows;
  },

  async revenueSummary() {
    const { rows } = await pool.query(`
      SELECT method, currency, SUM(amount) AS total, COUNT(*) AS count
      FROM payments WHERE status = 'completed'
      GROUP BY method, currency
    `);
    return rows;
  },
};

module.exports = { PaymentModel };
