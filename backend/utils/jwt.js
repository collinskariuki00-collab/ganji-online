const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DEFAULT_EXPIRES_IN = '7d';

function sign(payload, expiresIn = DEFAULT_EXPIRES_IN) {
  return jwt.sign(payload, SECRET, { expiresIn });
}

function verify(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { sign, verify };
