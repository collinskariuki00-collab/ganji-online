const express = require('express');
const router  = express.Router();

const { requireAuth } = require('../middleware/auth');
const { TrialModel, TRIAL_HOURS } = require('../models/trialModel');
const { BlockedIpModel } = require('../models/blockedIpModel');
const { SubscriptionModel } = require('../models/subscriptionModel');
const { ActivityLogModel } = require('../models/activityLogModel');
const { getClientIp } = require('../utils/clientIp');
const { logger } = require('../utils/logger');

module.exports = (botManager) => {

  router.get('/status', requireAuth, async (req, res) => {
    res.json({ claimed: await TrialModel.hasClaimed(req.user.id), hours: TRIAL_HOURS });
  });

  router.post('/claim', requireAuth, async (req, res) => {
    try {
      const { deviceId } = req.body || {};
      if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8) {
        return res.status(400).json({ error: 'Missing or invalid device id' });
      }
      const ip = getClientIp(req);

      if (await BlockedIpModel.isBlocked(ip)) {
        return res.status(403).json({ error: 'This network is blocked from using Huantam. Contact support if you believe this is a mistake.' });
      }

      const { eligible, reason } = await TrialModel.checkEligibility(req.user.id, deviceId, ip);
      if (!eligible) {
        return res.status(409).json({ error: reason });
      }

      const { expiresAt } = await TrialModel.claim(req.user.id, deviceId, ip);
      await SubscriptionModel.activate(req.user.id, 'bot', 'trial', TRIAL_HOURS);
      await botManager.refreshAccess(req.user.id);
      await ActivityLogModel.log(req.user.id, 'trial_claimed', { deviceId, expiresAt }, ip);

      logger.info(`Trial claimed by user ${req.user.id} (ip ${ip})`);
      res.json({ ok: true, expiresAt, hours: TRIAL_HOURS });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
