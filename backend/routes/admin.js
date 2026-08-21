const express = require('express');
const router  = express.Router();

const { requireAuth, requireAdmin } = require('../middleware/auth');
const { UserModel } = require('../models/userModel');
const { PaymentModel } = require('../models/paymentModel');
const { AppConfigModel } = require('../models/appConfigModel');
const { AnthropicClient } = require('../services/anthropicClient');
const { ActivityLogModel } = require('../models/activityLogModel');
const { BlockedIpModel } = require('../models/blockedIpModel');
const { logger } = require('../utils/logger');

module.exports = (botManager) => {
  router.use(requireAuth, requireAdmin);

  // Client list with subscription status + live bot state (running/stopped,
  // demo/live, open trade count) for whichever clients currently have a bot
  // instance loaded in memory.
  router.get('/clients', async (_req, res) => {
    const users = await UserModel.listWithSubscriptions();
    const running = new Map(botManager.overview().map(o => [o.userId, o]));
    res.json(users.map(u => ({ ...u, bot: running.get(u.id) || null })));
  });

  router.post('/clients/:id/disable', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await UserModel.setActive(id, false);
    botManager.evict(id); // stops their bot immediately
    logger.warn(`Admin disabled client ${id}`);
    ActivityLogModel.log(id, 'admin_disable_client', { by: req.user.email });
    res.json({ ok: true });
  });

  router.post('/clients/:id/enable', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await UserModel.setActive(id, true);
    ActivityLogModel.log(id, 'admin_enable_client', { by: req.user.email });
    res.json({ ok: true });
  });

  // Manually create a client account from the admin dashboard — e.g. giving
  // someone free/comp access without them going through public signup.
  // Skips email verification entirely since the admin is vouching for them.
  router.post('/clients', async (req, res) => {
    const { email, password, role } = req.body || {};
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Email and a password of at least 8 characters are required' });
    }
    const existing = await UserModel.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const user = await UserModel.create(email, password, role === 'admin' ? 'admin' : 'client');
    await UserModel.markVerified(user.id);
    logger.warn(`Admin ${req.user.email} manually created account ${user.email} (role: ${user.role})`);
    ActivityLogModel.log(user.id, 'admin_create_client', { email: user.email, role: user.role, by: req.user.email });
    res.json({ ok: true, user });
  });

  // Permanent delete. Cascades (binance_keys, subscriptions, payments,
  // trial_claims) via FK; activity_log rows survive with user_id set NULL.
  router.delete('/clients/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = await UserModel.findById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Cannot delete an admin account from this panel' });

    botManager.evict(id); // stop their bot first so nothing writes to a vanished user mid-delete
    await UserModel.remove(id);
    logger.warn(`Admin ${req.user.email} permanently deleted client ${target.email} (id ${id})`);
    ActivityLogModel.log(null, 'admin_delete_client', { deletedEmail: target.email, deletedId: id, by: req.user.email });
    res.json({ ok: true });
  });

  // Live positions/PnL for every client whose bot is currently loaded in
  // memory (same scope as the 'bot' field on GET /clients, but with real
  // Binance position data instead of just an open-trade count).
  router.get('/bots/live', async (_req, res) => {
    try {
      const [live, users] = await Promise.all([botManager.liveOverview(), UserModel.listWithSubscriptions()]);
      const emailMap = new Map(users.map(u => [u.id, u.email]));
      res.json(live.map(l => ({ ...l, email: emailMap.get(l.userId) || null })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Activity feed ────────────────────────────────────────────
  router.get('/activities', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    res.json(await ActivityLogModel.recent(limit));
  });

  // ── IP blocklist (manual abuse tool) ─────────────────────────
  router.get('/blocked-ips', async (_req, res) => {
    res.json(await BlockedIpModel.list());
  });

  router.post('/blocked-ips', async (req, res) => {
    const { ip, reason } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip is required' });
    await BlockedIpModel.block(ip, reason, req.user.email);
    ActivityLogModel.log(null, 'admin_block_ip', { ip, reason, by: req.user.email }, ip);
    logger.warn(`Admin ${req.user.email} blocked IP ${ip}`);
    res.json({ ok: true });
  });

  router.delete('/blocked-ips/:ip', async (req, res) => {
    const ip = req.params.ip;
    await BlockedIpModel.unblock(ip);
    ActivityLogModel.log(null, 'admin_unblock_ip', { ip, by: req.user.email });
    res.json({ ok: true });
  });

  router.get('/revenue', async (_req, res) => {
    res.json(await PaymentModel.revenueSummary());
  });

  // Global config: shared Anthropic key, plan pricing. Updating the key
  // rebuilds the shared AnthropicClient and pushes it into every already
  // running bot instance — no restart needed.
  router.get('/config', async (_req, res) => {
    const cfg = await AppConfigModel.getAll();
    res.json({ ...cfg, anthropic_api_key: cfg.anthropic_api_key ? '••••••••' + cfg.anthropic_api_key.slice(-4) : '' });
  });

  router.patch('/config', async (req, res) => {
    const { anthropic_api_key, ...priceFields } = req.body || {};
    if (anthropic_api_key) {
      await AppConfigModel.set('anthropic_api_key', anthropic_api_key);
      botManager.setSharedAnthropic(new AnthropicClient(anthropic_api_key));
      logger.info('Admin updated shared Anthropic API key');
    }
    const allowedKeys = [
      'monthly_price_kes', 'monthly_price_usdt',
      'daily_price_kes', 'daily_price_usdt',
    ];
    for (const key of allowedKeys) {
      const val = priceFields[key];
      if (val !== undefined && val !== null && val !== '') await AppConfigModel.set(key, String(val));
    }
    res.json({ ok: true });
  });

  router.get('/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    res.json(logger.getRecent(limit));
  });

  return router;
};
