-- Multi-tenant SaaS schema for Huantam (Binance Futures bot-as-a-service)
-- Run once: psql -U <user> -d <db> -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'client',   -- 'client' | 'admin'
  is_active     BOOLEAN NOT NULL DEFAULT true,     -- admin kill-switch, independent of subscription
  last_login_at TIMESTAMPTZ,
  last_login_ip TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Email verification ─────────────────────────────────────
  email_verified        BOOLEAN NOT NULL DEFAULT false,
  verification_token     TEXT,
  verification_expires    TIMESTAMPTZ,

  -- ── Forgot-password ─────────────────────────────────────────
  reset_token         TEXT,
  reset_token_expires  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);

-- Each user's Binance keys, encrypted at rest (AES-256-GCM, see utils/crypto.js).
-- Separate live/demo rows since Binance issues distinct keys per environment.
CREATE TABLE IF NOT EXISTS binance_keys (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('live','demo')),
  api_key_enc   TEXT NOT NULL,
  api_secret_enc TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mode)
);

-- Two independent subscription products: 'bot' (running the trading bot,
-- which includes full signals for free) and 'signals' (full signal detail
-- only, no bot execution). A user can hold either or both.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product       TEXT NOT NULL CHECK (product IN ('bot','signals')),
  status        TEXT NOT NULL DEFAULT 'inactive',  -- 'inactive' | 'active' | 'expired'
  plan          TEXT NOT NULL DEFAULT 'monthly',
  expires_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product)
);

CREATE TABLE IF NOT EXISTS payments (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product       TEXT NOT NULL DEFAULT 'bot',        -- 'bot' | 'signals' (derived from plan)
  plan          TEXT NOT NULL DEFAULT 'ultimate',    -- 'ultimate' | 'premium' | 'basic'
  method        TEXT NOT NULL,                     -- 'mpesa' | 'card' | 'crypto'
  amount        NUMERIC NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'KES',
  status        TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'completed' | 'failed'
  reference     TEXT,                                -- provider checkout/txn id
  raw_callback  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin-editable global config (e.g. shared Anthropic key, plan prices) so
-- these can change without redeploying. Values are plain text; secrets
-- should still only ever be read server-side.
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Two plans (see backend/config/plans.js for what each grants):
--   monthly — $25 (30 days), full access, all pairs
--   daily   — $1 (24 hours), full access, all pairs
INSERT INTO app_config (key, value) VALUES
  ('anthropic_api_key', ''),
  ('monthly_price_kes', '3250'),
  ('monthly_price_usdt', '25'),
  ('daily_price_kes', '130'),
  ('daily_price_usdt', '1')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ── Free trial (24h), one per account/device/IP, best-effort ────────────
-- One row per user is the hard guarantee (unique on user_id). device_id and
-- ip_address are a soft second layer — device_id is a client-generated
-- token in localStorage (survives normal browsing, wiped by clearing
-- storage or a fresh browser profile), and ip_address will occasionally
-- false-positive on shared/carrier-NAT connections. Neither is airtight;
-- combined they raise the cost of abuse without being a hard technical wall.
CREATE TABLE IF NOT EXISTS trial_claims (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  ip_address  TEXT NOT NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_claims_device ON trial_claims(device_id);
CREATE INDEX IF NOT EXISTS idx_trial_claims_ip ON trial_claims(ip_address);

-- Admin-managed IP blocklist — manual tool for actual abuse, not an
-- automatic "block after every trial" (that would eventually lock out
-- legitimate paying customers sharing a carrier-NAT IP with an abuser).
-- Enforced globally in server.js for every /api/* request.
CREATE TABLE IF NOT EXISTS blocked_ips (
  ip_address  TEXT PRIMARY KEY,
  reason      TEXT,
  blocked_by  TEXT,                              -- admin email, or 'system'
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activity feed for the admin dashboard — logins, registrations, trial
-- claims, payments, bot start/stop. user_id is nullable so failed-login-type
-- events (no known user yet) can still be recorded if ever added later.
CREATE TABLE IF NOT EXISTS activity_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,                     -- 'register' | 'login' | 'email_verified' | 'password_reset' | 'trial_claimed' | 'payment_completed' | 'bot_started' | 'bot_stopped' | 'admin_block_ip' | 'admin_unblock_ip' | 'admin_disable_client' | 'admin_enable_client' | 'admin_create_client' | 'admin_delete_client'
  detail      JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);

-- ── Migration note for an existing install ───────────────────────────────
--
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip TEXT;
--   -- then re-run the three CREATE TABLE blocks above (trial_claims,
--   -- blocked_ips, activity_log) plus their indexes — all use IF NOT EXISTS.

-- ── Migration note for an existing install (email verification + forgot
-- password, added after the initial commercial build) ───────────────────
--
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMPTZ;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
--   CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
--   CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);
--   -- Existing accounts predate verification — mark them verified so
--   -- current users aren't locked out of login:
--   UPDATE users SET email_verified = true WHERE created_at < now();

-- ── Migration note for an existing install (had the old basic/premium/
-- ultimate/ultimate_daily pair-tiered pricing) ───────────────────────────
--
--   ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'monthly';
--   DELETE FROM app_config WHERE key LIKE '%_price_%';
--   INSERT INTO app_config (key, value) VALUES
--     ('monthly_price_kes', '3250'), ('monthly_price_usdt', '25'),
--     ('daily_price_kes', '130'), ('daily_price_usdt', '1')
--   ON CONFLICT (key) DO NOTHING;
--   -- Old subscription rows referencing removed plan names (basic/premium/
--   -- ultimate/ultimate_daily) still work fine as-is — SubscriptionModel
--   -- only cares about product+status+expires_at, plan name is just a label.
