const { pool } = require('../db/pool');

const AppConfigModel = {
  async get(key) {
    const { rows } = await pool.query(`SELECT value FROM app_config WHERE key = $1`, [key]);
    return rows[0]?.value ?? null;
  },

  async set(key, value) {
    await pool.query(
      `INSERT INTO app_config (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value]
    );
  },

  async getAll() {
    const { rows } = await pool.query(`SELECT key, value FROM app_config`);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },
};

module.exports = { AppConfigModel };
