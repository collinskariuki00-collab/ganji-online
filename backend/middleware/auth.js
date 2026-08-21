const { verify } = require('../utils/jwt');
const { SubscriptionModel } = require('../models/subscriptionModel');

// Reads the session cookie set at login. Every existing frontend fetch('/api/...')
// call works unchanged because browsers send same-origin cookies automatically —
// no Authorization header wiring needed in the existing pages.
function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.user = verify(token); // { id, email, role }
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
  next();
}

// Gate on the client actually having a paid, active subscription before
// letting them start a bot or view full signal detail. `product` is
// 'bot' or 'signals' — bot subscribers automatically pass the signals gate.
function requireProduct(product) {
  return async (req, res, next) => {
    try {
      const ok = product === 'bot'
        ? await SubscriptionModel.hasBotAccess(req.user.id)
        : await SubscriptionModel.hasSignalsAccess(req.user.id);
      if (!ok) return res.status(402).json({ error: `${product === 'bot' ? 'Bot' : 'Signals'} subscription inactive — please subscribe to continue.` });
      next();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

module.exports = { requireAuth, requireAdmin, requireProduct };
