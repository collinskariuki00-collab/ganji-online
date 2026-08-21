const { pool } = require('../db/pool');

const BlockedIpModel = {
  async isBlocked(ip) {
    const { rows } = await pool.query(`SELECT 1 FROM blocked_ips WHERE ip_address = $1`, [ip]);
    return rows.length > 0;
  },

  async block(ip, reason, blockedBy) {
    await pool.query(
      `INSERT INTO blocked_ips (ip_address, reason, blocked_by) VALUES ($1,$2,$3)
       ON CONFLICT (ip_address) DO UPDATE SET reason = $2, blocked_by = $3, blocked_at = now()`,
      [ip, reason || null, blockedBy || 'system']
    );
  },

  async unblock(ip) {
    await pool.query(`DELETE FROM blocked_ips WHERE ip_address = $1`, [ip]);
  },

  async list() {
    const { rows } = await pool.query(`SELECT * FROM blocked_ips ORDER BY blocked_at DESC`);
    return rows;
  },
};

module.exports = { BlockedIpModel };
