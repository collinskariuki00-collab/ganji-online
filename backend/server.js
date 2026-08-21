require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express     = require('express');
const http        = require('http');
const url         = require('url');
const WebSocket   = require('ws');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { logger } = require('./utils/logger');
const { verify } = require('./utils/jwt');
const { AnthropicClient } = require('./services/anthropicClient');
const { BotManager } = require('./services/botManager');
const { AppConfigModel } = require('./models/appConfigModel');

const authRoutes        = require('./routes/auth');
const binanceKeysRoutesFactory = require('./routes/binanceKeys');
const paymentRoutesFactory = require('./routes/payments');
const botRoutesFactory   = require('./routes/bot');
const adminRoutesFactory = require('./routes/admin');
const trialRoutesFactory = require('./routes/trial');
const { BlockedIpModel } = require('./models/blockedIpModel');
const { getClientIp } = require('./utils/clientIp');

const app    = express();
app.set('trust proxy', false); // set true behind a real reverse proxy (nginx) in production
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Allowed browser origins for cross-site cookies: the client-facing site
// (FRONTEND_URL) and the separate admin dashboard app (ADMIN_APP_URL).
// Comma-separate ADMIN_APP_URL if the admin app has more than one URL
// (e.g. a local dev port and a deployed one) — e.g.
// ADMIN_APP_URL=http://localhost:3001,https://admin.yourdomain.com
//
// Also allows the backend's own address. Reason: in dev, Create React
// App's proxy (the "proxy" field in frontend/admin-dashboard package.json,
// which sets changeOrigin: true) rewrites the Origin header on proxied
// POST/PUT/DELETE requests to match its proxy TARGET — i.e. the backend
// itself — instead of preserving the browser's real origin. So a
// perfectly legitimate request from localhost:3000 can arrive here
// looking like it came from localhost:4000. Trusting the backend's own
// origin accounts for that without weakening anything meaningful, since
// this is a local dev proxy artifact, not a real external origin.
//
// Trailing slashes are stripped on both sides before comparing — some
// clients (curl, certain browser tab/devtools scenarios, health checks,
// and this same CRA proxy quirk) send an Origin header with a trailing
// slash even though the configured URLs above never have one.
const PORT = process.env.PORT || 4000;
const stripSlash = (s) => s.replace(/\/+$/, '');
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  ...String(process.env.ADMIN_APP_URL || 'http://localhost:3001').split(',').map(s => s.trim()).filter(Boolean),
  `http://localhost:${PORT}`,
].map(stripSlash);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    // No origin = same-origin/server-to-server/curl — allow. Otherwise the
    // origin must be in the explicit allowlist above.
    if (!origin || allowedOrigins.includes(stripSlash(origin))) return cb(null, true);
    logger.warn(`CORS: rejected origin ${origin} (allowed: ${allowedOrigins.join(', ')})`);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
// Without this, a CORS rejection falls through to Express's default error
// handler, which returns an HTML stack-trace page — and a frontend trying
// to JSON.parse() that gets a confusing "Unexpected token '<'" error that
// has nothing to do with the actual problem. Return clean JSON instead.
app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next(err);
});

// Paystack webhook needs the raw body for HMAC signature verification, so
// it must be registered BEFORE express.json() strips/parses the body.
app.use('/api/payments/card/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(cookieParser());
app.use(rateLimit({
  windowMs: 60_000,
  max: 300,
  // Silences a false-positive warning on Windows/localhost where Node
  // sometimes reports an X-Forwarded-For-like header even with no reverse
  // proxy in front. If you later put this behind nginx/Caddy, set
  // app.set('trust proxy', 1) above instead of skipping validation.
  validate: { xForwardedForHeader: false },
}));

// ── Admin-managed IP blocklist ───────────────────────────────
// Manual tool for actual abuse (see /api/admin/blocked-ips) — not an
// automatic consequence of using a trial. Checked on every API request.
app.use('/api', async (req, res, next) => {
  try {
    const ip = getClientIp(req);
    if (await BlockedIpModel.isBlocked(ip)) {
      return res.status(403).json({ error: 'This network has been blocked. Contact support if you believe this is a mistake.' });
    }
    next();
  } catch (e) {
    logger.error('Blocked-IP check failed: ' + e.message);
    next(); // fail open — a DB hiccup here shouldn't take the whole API down
  }
});

// ── Per-client WebSocket routing ─────────────────────────────
// Clients connect with ws://host?token=<session JWT> (cookies aren't
// automatically attached to WebSocket handshakes in all browsers/proxies,
// so the frontend passes the token explicitly as a query param).
const socketsByUser = new Map(); // userId -> Set<ws>

function broadcastToUser(userId, data) {
  const set = socketsByUser.get(userId);
  if (!set || set.size === 0) return;

  // No more field-stripping here — scanning itself (see
  // TradingBot.startScanning / botManager.refreshAccess) is now the only
  // gate. If a user's socket is receiving 'signals' messages at all, they
  // have an active subscription and get full detail.
  const msg = JSON.stringify(data);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const { query } = url.parse(req.url, true);
  let userId;
  try {
    userId = verify(query.token).id;
  } catch {
    ws.close(4001, 'Unauthorized');
    return;
  }
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId).add(ws);

  ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
  ws.on('close', () => socketsByUser.get(userId)?.delete(ws));
  ws.on('error', e => logger.error('WS error: ' + e.message));
});

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  const savedKey = await AppConfigModel.get('anthropic_api_key');
  const anthropic = new AnthropicClient(savedKey || process.env.ANTHROPIC_API_KEY || '');
  const botManager = new BotManager({ anthropic, broadcastToUser });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));
  app.use('/api/auth', authRoutes);
  app.use('/api/binance-keys', binanceKeysRoutesFactory(botManager));
  app.use('/api/payments', paymentRoutesFactory(botManager));
  app.use('/api/trial', trialRoutesFactory(botManager));
  app.use('/api', botRoutesFactory(botManager));
  app.use('/api/admin', adminRoutesFactory(botManager));

  server.listen(PORT, () => {
    logger.info(`Huantam backend (multi-tenant) → http://localhost:${PORT}`);
  });
})();

process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
