const express = require('express');
const router  = express.Router();

const { UserModel } = require('../models/userModel');
const { SubscriptionModel } = require('../models/subscriptionModel');
const { ActivityLogModel } = require('../models/activityLogModel');
const { sign } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');
const { getClientIp } = require('../utils/clientIp');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/mailer');
const { logger } = require('../utils/logger');

// sameSite defaults to 'lax', which works fine for localhost dev and for
// same-registrable-domain deployments (e.g. app.yourdomain.com +
// admin.yourdomain.com are still "same-site" to the browser). If the admin
// app ever lives on a genuinely different domain, set COOKIE_SAMESITE=none
// in .env — that also requires COOKIE_SECURE=true (HTTPS), since browsers
// reject SameSite=None cookies over plain HTTP.
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: process.env.COOKIE_SAMESITE || 'lax',
  secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Email and a password of at least 8 characters are required' });
    }
    const existing = await UserModel.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const user = await UserModel.create(email, password, 'client');
    const ip = getClientIp(req);
    await ActivityLogModel.log(user.id, 'register', { email: user.email }, ip);

    // Account is created right away but stays unverified until the link is
    // clicked — login is blocked until then (see /login below). A failed
    // send shouldn't lose the account, so it's logged, not thrown.
    const token = await UserModel.setVerificationToken(user.id);
    try {
      await sendVerificationEmail(user.email, token);
    } catch (mailErr) {
      logger.error(`Verification email failed for ${user.email}: ${mailErr.message}`);
    }

    res.json({ user, message: 'Account created. Check your email to verify your account before logging in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Verification token is required' });

    const user = await UserModel.findByVerificationToken(token);
    if (!user) return res.status(400).json({ error: 'This verification link is invalid or has expired' });

    await UserModel.markVerified(user.id);
    const ip = getClientIp(req);
    await UserModel.updateLoginInfo(user.id, ip);
    await ActivityLogModel.log(user.id, 'email_verified', { email: user.email }, ip);

    // Log them straight in — no reason to make a just-verified user type
    // their password again.
    const jwtToken = sign({ id: user.id, email: user.email, role: user.role });
    res.cookie('session', jwtToken, COOKIE_OPTS);
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body || {};
    const user = await UserModel.findByEmail(email || '');
    // Same response whether or not the account exists / is already
    // verified, so this can't be used to enumerate registered emails.
    if (user && !user.email_verified) {
      const token = await UserModel.setVerificationToken(user.id);
      try {
        await sendVerificationEmail(user.email, token);
      } catch (mailErr) {
        logger.error(`Resend verification failed for ${user.email}: ${mailErr.message}`);
      }
    }
    res.json({ ok: true, message: 'If that account exists and is unverified, a new verification email has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    const user = await UserModel.findByEmail(email || '');
    // Same response either way — don't reveal whether the email is registered.
    if (user) {
      const token = await UserModel.setResetToken(user.id);
      try {
        await sendPasswordResetEmail(user.email, token);
      } catch (mailErr) {
        logger.error(`Password reset email failed for ${user.email}: ${mailErr.message}`);
      }
    }
    res.json({ ok: true, message: 'If that email is registered, a password reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'A reset token and a password of at least 8 characters are required' });
    }
    const user = await UserModel.findByResetToken(token);
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    await UserModel.resetPassword(user.id, password);
    const ip = getClientIp(req);
    await ActivityLogModel.log(user.id, 'password_reset', { email: user.email }, ip);
    res.json({ ok: true, message: 'Password updated. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body || {};
    const user = await UserModel.findByEmail(email || '');
    if (!user || !(await UserModel.verifyPassword(user, password || ''))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'This account has been disabled' });
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before logging in.', code: 'EMAIL_NOT_VERIFIED' });
    }

    const ip = getClientIp(req);
    await UserModel.updateLoginInfo(user.id, ip);
    await ActivityLogModel.log(user.id, 'login', { email: user.email }, ip);

    // "Remember me" unchecked = 7-day session (the existing default).
    // Checked = 30 days, on both the JWT's own expiry and the cookie that
    // carries it, so the two stay in sync.
    const maxAgeMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const token = sign({ id: user.id, email: user.email, role: user.role }, rememberMe ? '30d' : '7d');
    res.cookie('session', token, { ...COOKIE_OPTS, maxAge: maxAgeMs });
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await UserModel.findById(req.user.id);
  const botActive = await SubscriptionModel.hasBotAccess(req.user.id);
  const signalsActive = await SubscriptionModel.hasSignalsAccess(req.user.id);
  res.json({ user, subscription: { botActive, signalsActive } });
});

// Short-lived token for the WebSocket handshake — browsers don't reliably
// attach httpOnly cookies to WS connections, so the frontend fetches this
// once (cookie-authenticated) and passes it as a query param when opening
// the socket.
router.get('/ws-token', requireAuth, (req, res) => {
  res.json({ token: sign({ id: req.user.id, email: req.user.email, role: req.user.role }) });
});

module.exports = router;
