const express = require('express');
const router  = express.Router();

const { requireAuth } = require('../middleware/auth');
const { BinanceKeysModel } = require('../models/binanceKeysModel');

module.exports = (botManager) => {
  router.get('/status', requireAuth, async (req, res) => {
    res.json(await BinanceKeysModel.status(req.user.id));
  });

  router.post('/', requireAuth, async (req, res) => {
    try {
      const { apiKey, apiSecret } = req.body || {};
      if (!apiKey || !apiSecret) return res.status(400).json({ error: 'apiKey and apiSecret are required' });

      await BinanceKeysModel.set(req.user.id, apiKey, apiSecret);

      // If this user's bot instance is already loaded in memory (e.g. they
      // were already logged in and scanning), pull the new keys in
      // immediately instead of waiting for a server restart.
      const inst = await botManager.get(req.user.id);
      const result = await inst.binance.refreshCredentials();

      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
