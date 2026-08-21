const { pool } = require('../db/pool');

const TRIAL_HOURS = 24;

const TrialModel = {
  // Checks all three angles at once: has this account, this device, or this
  // IP already claimed a trial? Any one of them blocks a new claim.
  async checkEligibility(userId, deviceId, ip) {
    const { rows } = await pool.query(
      `SELECT user_id, device_id, ip_address FROM trial_claims
       WHERE user_id = $1 OR device_id = $2 OR ip_address = $3`,
      [userId, deviceId, ip]
    );
    if (rows.length === 0) return { eligible: true };

    const byUser = rows.find(r => r.user_id === userId);
    if (byUser) return { eligible: false, reason: 'This account has already used its free trial.' };
    const byDevice = rows.find(r => r.device_id === deviceId);
    if (byDevice) return { eligible: false, reason: 'This device has already claimed a free trial.' };
    return { eligible: false, reason: 'This network/IP has already claimed a free trial.' };
  },

  async claim(userId, deviceId, ip) {
    const expiresAt = new Date(Date.now() + TRIAL_HOURS * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO trial_claims (user_id, device_id, ip_address, expires_at) VALUES ($1,$2,$3,$4)`,
      [userId, deviceId, ip, expiresAt]
    );
    return { expiresAt, hours: TRIAL_HOURS };
  },

  async hasClaimed(userId) {
    const { rows } = await pool.query(`SELECT 1 FROM trial_claims WHERE user_id = $1`, [userId]);
    return rows.length > 0;
  },
};

module.exports = { TrialModel, TRIAL_HOURS };
