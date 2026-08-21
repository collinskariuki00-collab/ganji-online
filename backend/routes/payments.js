const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const { requireAuth } = require('../middleware/auth');
const { PaymentModel } = require('../models/paymentModel');
const { SubscriptionModel } = require('../models/subscriptionModel');
const { AppConfigModel } = require('../models/appConfigModel');
const { stkPush } = require('../services/mpesa');
const paystack = require('../services/paystack');
const { logger } = require('../utils/logger');
const { PLANS, isValidPlan } = require('../config/plans');
const { ActivityLogModel } = require('../models/activityLogModel');

module.exports = (botManager) => {

async function priceFor(plan, currency) {
  const key = currency === 'USDT' ? `${plan}_price_usdt` : `${plan}_price_kes`;
  const fallbacks = {
    monthly: { KES: 3250, USDT: 25 },
    daily:   { KES: 130,  USDT: 1 },
  };
  const stored = await AppConfigModel.get(key);
  return stored !== null && stored !== '' ? parseFloat(stored) : fallbacks[plan][currency];
}

async function activateForPlan(userId, plan, method, amount, currency) {
  const { product, hours } = PLANS[plan];
  const result = await SubscriptionModel.activate(userId, product, plan, hours);
  // Turns on signal scanning immediately for an already-open dashboard —
  // without this, a user who paid would still see nothing until their
  // next login (when _getOrCreate would've picked it up fresh).
  await botManager.refreshAccess(userId);
  await ActivityLogModel.log(userId, 'payment_completed', { plan, method, amount, currency });
  return result;
}

// ── M-Pesa (STK push) ────────────────────────────────────────
router.post('/mpesa/initiate', requireAuth, async (req, res) => {
  try {
    const { phone, plan } = req.body;
    if (!isValidPlan(plan)) return res.status(400).json({ error: 'plan must be "ultimate", "premium", or "basic"' });
    if (!/^2547\d{8}$/.test(phone || '')) {
      return res.status(400).json({ error: 'Phone must be in format 2547XXXXXXXX' });
    }
    const priceKes = await priceFor(plan, 'KES');
    const payment  = await PaymentModel.create(req.user.id, PLANS[plan].product, plan, 'mpesa', priceKes, 'KES');

    const result = await stkPush({
      phone,
      amount: priceKes,
      accountRef: `HUANTAM-${plan.toUpperCase()}-${req.user.id}`,
      description: `Huantam ${plan} plan`,
      callbackUrl: `${process.env.PUBLIC_BACKEND_URL}/api/payments/mpesa/callback?paymentId=${payment.id}`,
    });

    res.json({ payment, checkoutRequestId: result.CheckoutRequestID });
  } catch (err) {
    logger.error('M-Pesa initiate failed: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// Safaricom calls this — no auth (comes from Safaricom's servers), paymentId
// identifies which pending row to resolve.
router.post('/mpesa/callback', async (req, res) => {
  try {
    const paymentId = parseInt(req.query.paymentId, 10);
    const stk = req.body?.Body?.stkCallback;
    if (stk?.ResultCode === 0) {
      const payment = await PaymentModel.markCompleted(paymentId, req.body);
      await activateForPlan(payment.user_id, payment.plan, payment.method, payment.amount, payment.currency);
      logger.info(`M-Pesa payment ${paymentId} (${payment.plan}) completed, subscription activated`);
    } else {
      await PaymentModel.markFailed(paymentId, req.body);
    }
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    logger.error('M-Pesa callback error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Card (Paystack) ──────────────────────────────────────────
// Requires PAYSTACK_SECRET_KEY in .env — no extra npm package (plain HTTPS
// calls via axios, already a dependency). Priced in KES like M-Pesa, since
// Paystack settles straight to a Kenyan bank account (unlike Stripe, which
// doesn't offer Kenya-registered payout accounts at all).
router.post('/card/initiate', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!isValidPlan(plan)) return res.status(400).json({ error: 'plan must be "ultimate", "premium", or "basic"' });
    if (!paystack.isConfigured()) {
      return res.status(501).json({ error: 'Card payments not configured yet — add PAYSTACK_SECRET_KEY to .env' });
    }

    const priceKes = await priceFor(plan, 'KES');
    // Reference has to exist before calling Paystack (it's what the
    // webhook uses to find this row again), so create the payment record
    // first and build the reference from its own id.
    const payment = await PaymentModel.create(req.user.id, PLANS[plan].product, plan, 'card', priceKes, 'KES');
    const reference = `HUANTAM-${plan.toUpperCase()}-${payment.id}-${Date.now()}`;
    await PaymentModel.setReference(payment.id, reference);

    const init = await paystack.initializeTransaction({
      email: req.user.email,
      amountKes: priceKes,
      reference,
      callbackUrl: `${process.env.PUBLIC_FRONTEND_URL}/billing?status=success`,
      metadata: { userId: String(req.user.id), paymentId: String(payment.id), plan },
    });

    res.json({ url: init.authorization_url });
  } catch (err) {
    logger.error('Paystack initiate failed: ' + (err.response?.data?.message || err.message));
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// Paystack webhook — must be registered with express.raw() body parsing in
// server.js BEFORE the global express.json() middleware, same as the old
// Stripe route this replaced, since the HMAC signature check needs the
// exact raw bytes Paystack sent.
router.post('/card/webhook', async (req, res) => {
  try {
    if (!paystack.isConfigured()) return res.status(501).send('Paystack not configured');

    const signature = req.headers['x-paystack-signature'];
    if (!paystack.verifySignature(req.body, signature)) {
      logger.warn('Paystack webhook: signature mismatch, ignoring');
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const payment = await PaymentModel.findByReference(reference);
      if (!payment) {
        logger.warn(`Paystack webhook: no payment found for reference ${reference}`);
        return res.json({ received: true });
      }
      if (payment.status === 'completed') return res.json({ received: true }); // already handled, e.g. retried delivery

      // Don't just trust the webhook body — confirm with Paystack directly
      // before activating anything, per their own recommended practice.
      const verified = await paystack.verifyTransaction(reference);
      if (verified.status !== 'success') {
        logger.warn(`Paystack webhook: verify returned status "${verified.status}" for reference ${reference}`);
        return res.json({ received: true });
      }

      const completed = await PaymentModel.markCompleted(payment.id, event);
      await activateForPlan(completed.user_id, completed.plan, completed.method, completed.amount, completed.currency);
      logger.info(`Paystack payment ${payment.id} (${completed.plan}) completed, subscription activated`);
    }
    res.json({ received: true });
  } catch (err) {
    logger.error('Paystack webhook error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Crypto / USDT (NowPayments) ──────────────────────────────
// Requires NOWPAYMENTS_API_KEY in .env. Docs: https://documenter.getpostman.com/view/7907941/S1a32n38
router.post('/crypto/initiate', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!isValidPlan(plan)) return res.status(400).json({ error: 'plan must be "ultimate", "premium", or "basic"' });
    if (!process.env.NOWPAYMENTS_API_KEY) {
      return res.status(501).json({ error: 'Crypto payments not configured yet — add NOWPAYMENTS_API_KEY to .env' });
    }
    const priceUsdt = await priceFor(plan, 'USDT');
    const payment = await PaymentModel.create(req.user.id, PLANS[plan].product, plan, 'crypto', priceUsdt, 'USDT');

    const { data } = await axios.post('https://api.nowpayments.io/v1/invoice', {
      price_amount: priceUsdt,
      price_currency: 'usd',
      pay_currency: 'usdttrc20',
      order_id: String(payment.id),
      ipn_callback_url: `${process.env.PUBLIC_BACKEND_URL}/api/payments/crypto/callback`,
      success_url: `${process.env.PUBLIC_FRONTEND_URL}/billing?status=success`,
    }, { headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY } });

    res.json({ payment, invoiceUrl: data.invoice_url });
  } catch (err) {
    logger.error('NowPayments initiate failed: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/crypto/callback', async (req, res) => {
  try {
    const paymentId = parseInt(req.body.order_id, 10);
    if (req.body.payment_status === 'finished' || req.body.payment_status === 'confirmed') {
      const payment = await PaymentModel.markCompleted(paymentId, req.body);
      await activateForPlan(payment.user_id, payment.plan, payment.method, payment.amount, payment.currency);
      logger.info(`Crypto payment ${paymentId} (${payment.plan}) completed, subscription activated`);
    }
    res.json({ received: true });
  } catch (err) {
    logger.error('NowPayments callback error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Status / history ─────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  const bot = await SubscriptionModel.get(req.user.id, 'bot');
  res.json({
    bot,
    botActive: await SubscriptionModel.hasBotAccess(req.user.id),
  });
});

router.get('/prices', requireAuth, async (_req, res) => {
  const out = {};
  for (const plan of Object.keys(PLANS)) {
    out[plan] = {
      kes: await priceFor(plan, 'KES'),
      usdt: await priceFor(plan, 'USDT'),
      hours: PLANS[plan].hours,
      product: PLANS[plan].product,
      label: PLANS[plan].label,
    };
  }
  res.json(out);
});

router.get('/history', requireAuth, async (req, res) => {
  const rows = await PaymentModel.listForUser(req.user.id);
  res.json(rows);
});

return router;

}; // end module.exports = (botManager) => { ... }
