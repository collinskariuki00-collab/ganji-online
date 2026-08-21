const path = require('path');
const { logger } = require('../utils/logger');
const { BotSettings } = require('../models/botSettings');
const { TradeStore }  = require('../models/tradeStore');
const { BinanceClient } = require('./binanceClient');
const { TradingBot }    = require('./tradingBot');
const { BinanceKeysModel } = require('../models/binanceKeysModel');
const { SubscriptionModel } = require('../models/subscriptionModel');

// Each client gets their own settings/trades JSON files (namespaced by user
// id under config/users/<id>/) and their own BinanceClient using their own
// encrypted keys. The AI layer (AnthropicClient) is the one thing shared
// across everyone — it's Waki's key, not the client's.
class BotManager {
  constructor({ anthropic, broadcastToUser }) {
    this.anthropic = anthropic;
    this.broadcastToUser = broadcastToUser; // (userId, data) => void — per-client WS push
    this.instances = new Map(); // userId -> { bot, binance, settings, tradeStore }
  }

  _configDir(userId) {
    return path.join(__dirname, '../../config/users', String(userId));
  }

  async _getOrCreate(userId) {
    if (this.instances.has(userId)) return this.instances.get(userId);

    const settings   = new BotSettings(path.join(this._configDir(userId), 'settings.json'));
    const tradeStore = new TradeStore(path.join(this._configDir(userId), 'trades.json'));

    const keyProvider = async () => BinanceKeysModel.get(userId);
    const binance = new BinanceClient(keyProvider);
    await binance.whenReady();

    const broadcast = (data) => this.broadcastToUser(userId, data);
    const bot = new TradingBot({ binance, anthropic: this.anthropic, settings, tradeStore, broadcast });

    // Scanning only starts if this user actually has a paid, active
    // subscription (bot or signals) right now — an unpaid account gets no
    // signals, no logs, nothing, until they pay. See refreshAccess() for
    // how this turns on the moment a payment webhook lands.
    const hasAccess = await SubscriptionModel.hasSignalsAccess(userId);
    if (hasAccess) bot.startScanning();

    const inst = { bot, binance, settings, tradeStore };
    this.instances.set(userId, inst);
    return inst;
  }

  // Called right after a payment activates a subscription (from the
  // mpesa/card/crypto webhook handlers) so an already-open dashboard starts
  // scanning immediately, without needing a page refresh. Also used to shut
  // scanning back off if we ever need to react to an expiry mid-session.
  async refreshAccess(userId) {
    const inst = this.instances.get(userId);
    if (!inst) return; // no instance in memory yet — will be checked fresh on next _getOrCreate anyway
    const hasAccess = await SubscriptionModel.hasSignalsAccess(userId);
    if (hasAccess) inst.bot.startScanning();
    else inst.bot.stopScanning();
  }

  async get(userId) {
    return this._getOrCreate(userId);
  }

  async start(userId) {
    const { bot } = await this._getOrCreate(userId);
    await bot.start();
    logger.info(`Bot started for user ${userId}`);
    return bot.running;
  }

  stop(userId) {
    const inst = this.instances.get(userId);
    if (!inst) return false;
    inst.bot.stop();
    logger.info(`Bot stopped for user ${userId}`);
    return inst.bot.running;
  }

  isRunning(userId) {
    return this.instances.get(userId)?.bot?.running || false;
  }

  // Admin visibility across every client currently loaded in memory.
  overview() {
    return Array.from(this.instances.entries()).map(([userId, inst]) => ({
      userId,
      running: inst.bot.running,
      mode: inst.binance.mode,
      openTrades: inst.tradeStore.getOpen().length,
    }));
  }

  // Same as overview(), but pulls each client's actual live positions
  // (symbol, side, entry/mark price, unrealized PnL, leverage) straight
  // from Binance instead of just a count. Used by the standalone admin
  // dashboard's "live bots" view. Only clients with a bot instance
  // currently loaded in memory show up here — same scope as overview()
  // and .../admin/clients — a client who hasn't opened their dashboard
  // or started their bot since the last server restart won't appear
  // until they do. Runs the Binance calls in parallel so one slow/broken
  // client doesn't stall the rest of the admin view.
  async liveOverview() {
    const entries = Array.from(this.instances.entries());
    return Promise.all(entries.map(async ([userId, inst]) => {
      let positions = [];
      let error = null;
      try {
        positions = await inst.binance.getOpenPositions();
      } catch (e) {
        error = e.message; // e.g. bad/revoked API key — surfaced to admin instead of silently dropped
      }
      return {
        userId,
        running: inst.bot.running,
        mode: inst.binance.mode,
        openTrades: inst.tradeStore.getOpen().length,
        positions,
        error,
      };
    }));
  }

  // Called when the admin panel updates the shared Anthropic key, so every
  // already-running bot picks it up without a server restart.
  setSharedAnthropic(anthropicClient) {
    this.anthropic = anthropicClient;
    for (const inst of this.instances.values()) inst.bot.anthropic = anthropicClient;
  }

  // Admin kill-switch: stop and drop a user's bot from memory (e.g. on ban
  // or subscription expiry cleanup). Their settings/trades files persist.
  evict(userId) {
    const inst = this.instances.get(userId);
    if (inst) { inst.bot.stop(); inst.bot.stopScanning(); }
    this.instances.delete(userId);
  }
}

module.exports = { BotManager };
