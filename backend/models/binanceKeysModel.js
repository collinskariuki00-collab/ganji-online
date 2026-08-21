const { pool } = require('../db/pool');
const { encrypt, decrypt } = require('../utils/crypto');

// Live trading only — one key pair per user. The old live/demo split was
// removed because it caused key-mismatch confusion (keys saved under one
// mode, account switched to the other, silently no keys found).
const BinanceKeysModel = {
  async set(userId, apiKey, apiSecret) {
    await pool.query(
      `INSERT INTO binance_keys (user_id, mode, api_key_enc, api_secret_enc, updated_at)
       VALUES ($1, 'live', $2, $3, now())
       ON CONFLICT (user_id, mode) DO UPDATE
       SET api_key_enc = EXCLUDED.api_key_enc, api_secret_enc = EXCLUDED.api_secret_enc, updated_at = now()`,
      [userId, encrypt(apiKey), encrypt(apiSecret)]
    );
  },

  // Returns decrypted { apiKey, apiSecret } or null if not set.
  async get(userId) {
    const { rows } = await pool.query(
      `SELECT api_key_enc, api_secret_enc FROM binance_keys WHERE user_id = $1 AND mode = 'live'`,
      [userId]
    );
    if (!rows[0]) return null;
    return { apiKey: decrypt(rows[0].api_key_enc), apiSecret: decrypt(rows[0].api_secret_enc) };
  },

  // For the settings UI — never return decrypted secrets to the client,
  // just whether a key is on file.
  async status(userId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM binance_keys WHERE user_id = $1 AND mode = 'live'`, [userId]
    );
    return { hasKeys: rows.length > 0 };
  },
};

module.exports = { BinanceKeysModel };
