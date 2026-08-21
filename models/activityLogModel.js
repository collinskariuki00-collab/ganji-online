const { pool } = require('../db/pool');

const ActivityLogModel = {
  async log(userId, eventType, detail = null, ip = null) {
    try {
      await pool.query(
        `INSERT INTO activity_log (user_id, event_type, detail, ip_address) VALUES ($1,$2,$3,$4)`,
        [userId, eventType, detail ? JSON.stringify(detail) : null, ip]
      );
    } catch (e) {
      // Activity logging is best-effort — never let a logging failure break
      // the actual request (login, payment, etc).
      console.error('ActivityLog.log failed:', e.message);
    }
  },

  async recent(limit = 200) {
    const { rows } = await pool.query(
      `SELECT a.id, a.event_type, a.detail, a.ip_address, a.created_at, u.email AS user_email
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [Math.min(limit, 500)]
    );
    return rows;
  },
};

module.exports = { ActivityLogModel };
