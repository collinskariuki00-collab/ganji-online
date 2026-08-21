// Encrypts client Binance API keys at rest. Requires MASTER_KEY in .env —
// a 32-byte value, e.g. generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const crypto = require('crypto');

function getKey() {
  const raw = process.env.MASTER_KEY;
  if (!raw) throw new Error('MASTER_KEY is not set in .env — required to encrypt/decrypt client API keys');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('MASTER_KEY must be a 32-byte hex string (64 hex chars)');
  return key;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
