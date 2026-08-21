const express = require('express');
const router  = express.Router();

const { requireAuth, requireProduct } = require('../middleware/auth');
const { SubscriptionModel } = require('../models/subscriptionModel');
const { PLANS } = require('../config/plans');
const { ActivityLogModel } = require('../models/activityLogModel');
const { getClientIp } = require('../utils/clientIp');

module.exports = (botManager) => {
  // Bot control — starting a bot requires an active paid subscription.
  // Everything else (viewing settings/trades/balance) just requires login,
  // so a lapsed client can still see their history and pay to resume.
  router.get('/bot/status', requireAuth, async (req, res) => {
    res.json({ running: botManager.isRunning(req.user.id) });
  });

  router.post('/bot/start', requireAuth, requireProduct('bot'), async (req, res) => {
    try {
      const running = await botManager.start(req.user.id);
      ActivityLogModel.log(req.user.id, 'bot_started', null, getClientIp(req));
      res.json({ running });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/bot/stop', requireAuth, (req, res) => {
    const running = botManager.stop(req.user.id);
    ActivityLogModel.log(req.user.id, 'bot_stopped', null, getClientIp(req));
    res.json({ running });
  });

  // Live account status — whether keys are on file (a check, not a toggle;
  // there's no demo/live selection anymore).
  router.get('/bot/account-mode', requireAuth, async (req, res) => {
    const { binance } = await botManager.get(req.user.id);
    res.json({ mode: 'live', hasKeys: !!(binance.apiKey && binance.apiSecret) });
  });

  // Settings
  router.get('/settings', requireAuth, async (req, res) => {
    const { settings } = await botManager.get(req.user.id);
    const plan = await SubscriptionModel.getActivePlanName(req.user.id);
    res.json({ ...settings.getAll(), maxPairs: plan ? PLANS[plan].maxPairs : 0 });
  });
  router.patch('/settings', requireAuth, async (req, res) => {
    const { settings } = await botManager.get(req.user.id);

    // Enforce the plan's pair cap server-side — the frontend also disables
    // extra checkboxes, but that's cosmetic; this is the real gate.
    if (Array.isArray(req.body?.pairs)) {
      const plan = await SubscriptionModel.getActivePlanName(req.user.id);
      const maxPairs = plan ? PLANS[plan].maxPairs : 0; // no active plan -> 0 tradeable pairs
      if (maxPairs !== null && req.body.pairs.length > maxPairs) {
        return res.status(400).json({
          error: plan
            ? `Your ${plan} plan allows up to ${maxPairs} tradeable pair${maxPairs === 1 ? '' : 's'} — you selected ${req.body.pairs.length}. Remove some or upgrade your plan.`
            : `You need an active subscription to select tradeable pairs.`,
        });
      }
    }

    res.json(settings.update(req.body));
  });
  router.post('/settings/reset', requireAuth, async (req, res) => {
    const { settings } = await botManager.get(req.user.id);
    res.json(settings.reset());
  });

  // Balance / positions
  router.get('/balance', requireAuth, async (req, res) => {
    try {
      const { binance } = await botManager.get(req.user.id);
      res.json(await binance.getBalance());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/positions', requireAuth, async (req, res) => {
    try {
      const { binance } = await botManager.get(req.user.id);
      res.json(await binance.getOpenPositions());
    } catch {
      res.json([]); // same "always an array" contract the frontend expects
    }
  });

  // Trades
  router.get('/trades', requireAuth, async (req, res) => {
    const { tradeStore } = await botManager.get(req.user.id);
    res.json(tradeStore.getAll());
  });
  router.get('/trades/open', requireAuth, async (req, res) => {
    const { tradeStore } = await botManager.get(req.user.id);
    res.json(tradeStore.getOpen());
  });
  router.get('/trades/closed', requireAuth, async (req, res) => {
    const { tradeStore } = await botManager.get(req.user.id);
    res.json(tradeStore.getClosed());
  });
  router.get('/trades/stats', requireAuth, async (req, res) => {
    const { tradeStore } = await botManager.get(req.user.id);
    res.json(tradeStore.getStats());
  });

  router.post('/trades/manual', requireAuth, requireProduct('bot'), async (req, res) => {
    try {
      const { symbol, side } = req.body;
      const { bot, binance, settings, tradeStore } = await botManager.get(req.user.id);
      const cfg = settings.getAll();
      const markPrice = await binance.getMarkPrice(symbol);
      const { availableBalance } = await binance.getBalance();
      const usd = cfg.tradeMode === 'pct' ? availableBalance * (cfg.tradeAmountPct / 100) : cfg.tradeAmountUsd;
      const quantity = bot.calcQuantity(usd, markPrice, cfg.leverage);
      const order = await binance.placeOrder({ symbol, side, quantity, takeProfitPct: cfg.takeProfitPct, stopLossPct: cfg.stopLossPct, leverage: cfg.leverage });
      tradeStore.add(order);
      res.json(order);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/trades/:orderId/close', requireAuth, async (req, res) => {
    try {
      const { orderId } = req.params;
      const { binance, tradeStore } = await botManager.get(req.user.id);
      const trade = tradeStore.getAll().find(t => t.orderId === orderId);
      if (!trade) return res.status(404).json({ error: `No trade found with orderId ${orderId}` });
      if ((trade.status || '').toUpperCase() !== 'OPEN') {
        return res.status(400).json({ error: `Trade ${orderId} is already ${trade.status}` });
      }
      const result = await binance.closePosition(trade.symbol);
      const closed = tradeStore.close(orderId, result.closePrice, result.pnl);
      res.json(closed);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Signals — full detail always, since access is already gated at the
  // scanning level (an unpaid account never generates signals in the first
  // place — see botManager.refreshAccess / TradingBot.startScanning).
  router.get('/signals', requireAuth, async (req, res) => {
    const { bot } = await botManager.get(req.user.id);
    const min = parseInt(req.query.minProbability) || 0;
    res.json((bot.allSignals || []).filter(s => s.probability >= min));
  });
  router.get('/signals/trade', requireAuth, async (req, res) => {
    const { bot } = await botManager.get(req.user.id);
    const min = parseInt(req.query.minProbability) || 0;
    res.json((bot.latestSignals || []).filter(s => s.probability >= min));
  });

  // Stats
  router.get('/stats', requireAuth, async (req, res) => {
    const { tradeStore } = await botManager.get(req.user.id);
    const stats = tradeStore.getStats();
    const pnlHistory = tradeStore.getClosed().map(t => ({ date: t.closedAt, pnl: t.pnl, symbol: t.symbol }));
    res.json({ ...stats, pnlHistory });
  });

  // Claude market analysis — uses the shared Anthropic key, not the client's.
  router.post('/anthropic/market-analysis', requireAuth, requireProduct('bot'), async (req, res) => {
    try {
      const { binance, bot } = await botManager.get(req.user.id);
      const prices = await binance.getAllMarkPrices();
      const positions = await binance.getOpenPositions();
      const analysis = await bot.anthropic.analyseMarket(prices, positions);
      res.json({ analysis: analysis || 'AI analysis is not configured yet — contact support.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Per-user log history — this bot instance's own private buffer, safe
  // for any logged-in client to see (unlike the global server logger,
  // which is admin-only since it mixes every user's activity together).
  router.get('/logs', requireAuth, async (req, res) => {
    const { bot } = await botManager.get(req.user.id);
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    res.json(bot.logBuffer.slice(-limit));
  });

  return router;
};
