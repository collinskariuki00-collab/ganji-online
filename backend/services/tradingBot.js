const { logger } = require('../utils/logger');
const { SignalEngine } = require('./signalEngine');

class TradingBot {
  constructor({ binance, anthropic, settings, tradeStore, broadcast }) {
    this.binance      = binance;
    this.anthropic    = anthropic;
    this.settings     = settings;
    this.tradeStore   = tradeStore;
    this.broadcast    = broadcast;
    this.engine       = new SignalEngine();
    this.running      = false; // trade execution — requires 'bot' plan (Ultimate/Premium)
    this.scanning     = false; // signal generation — runs for everyone once logged in, gated separately
    this.scanTimer    = null;
    this.priceTimer   = null;
    this.statusTimer  = null;
    // allSignals = every watchPair signal (for display)
    // latestSignals = only tradeable pairs' signals (for legacy /api/signals)
    this.allSignals    = [];
    this.latestSignals = [];
    this.dailyTradeCount   = 0;
    this.lastDayReset      = new Date().toDateString();
    this.resting           = false;

    // Private per-user log buffer — this bot instance's own activity only,
    // separate from the global server-side logger. Broadcast live to this
    // user's socket and kept here so the Logs page has history on load.
    this.logBuffer = [];
  }

  _log(level, message) {
    logger[level](message); // still goes to the server console/file for ops visibility
    const entry = { time: new Date().toISOString(), level: level.toUpperCase(), message };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > 500) this.logBuffer.shift();
    this.broadcast({ type: 'log', ...entry });
  }

  // Starts generating signals (probability scores, then full detail once
  // unlocked) without executing any trades. Called automatically whenever
  // a user's bot instance is created — signals are the free/paid-tier
  // teaser and shouldn't depend on trade-execution access at all.
  startScanning() {
    if (this.scanning) return;
    this.scanning = true;
    this._scheduleScan();

    // Prices need to stream regardless of trading, so the Dashboard price
    // strip works for everyone too.
    if (!this.priceTimer) {
      this.priceTimer = setInterval(() => this._broadcastPrices(), 2000);
    }
  }

  stopScanning() {
    this.scanning = false;
    clearTimeout(this.scanTimer);
    if (!this.running) clearInterval(this.priceTimer), (this.priceTimer = null);
  }

  // Enables actual trade execution — requires an active 'bot' plan
  // (Ultimate/Premium), enforced by the route calling this, not here.
  async start() {
    if (this.running) return;
    this.running = true;
    this._log('info', 'Bot started');
    this.broadcast({ type: 'bot_status', running: true });
    this.startScanning(); // trading implies scanning is on too

    this.statusTimer = setInterval(() => {
      this._broadcastBalance();
      this._broadcastPositions();
      this._reconcileTrades().catch(e => this._log('error', 'Reconcile error: ' + e.message));
    }, 5000);
  }

  // Stops trade execution only — signal scanning keeps running so the
  // Signals/Dashboard pages stay live even while the bot itself is off.
  stop() {
    this.running = false;
    clearInterval(this.statusTimer);
    this._log('info', 'Bot stopped');
    this.broadcast({ type: 'bot_status', running: false });
  }

  _scheduleScan() {
    const ms = (this.settings.get('scanIntervalSeconds') || 60) * 1000;
    this.scanTimer = setTimeout(async () => {
      if (!this.scanning) return;
      await this._scan().catch(e => this._log('error', 'Scan error: ' + e.message));
      this._scheduleScan();
    }, ms);
  }

  async _scan() {
    this._resetDaily();
    const cfg = this.settings.getAll();

    // watchPairs = full display list; pairs = tradeable subset
    const watchPairs   = cfg.watchPairs && cfg.watchPairs.length ? cfg.watchPairs : cfg.pairs;
    const tradePairSet = new Set(cfg.pairs || []);

    const openPositions = await this.binance.getOpenPositions();

    // ── Rest at capacity ──────────────────────────────────────────────
    // Once every trade slot is full there's nothing to do with a new
    // signal even if we found one, so skip building signals and calling
    // Claude entirely until a slot frees up. _reconcileTrades() runs on
    // its own faster (5s) timer independent of this scan loop, so a
    // closed trade is detected promptly and the very next scan resumes
    // normally — nothing is missed by resting here.
    if (openPositions.length >= cfg.maxOpenTrades) {
      if (!this.resting) {
        this.resting = true;
        this._log('info', `Resting — ${openPositions.length}/${cfg.maxOpenTrades} trade slots full. Pausing scans and Claude calls until a trade closes.`);
        this.broadcast({ type: 'bot_resting', resting: true, openTrades: openPositions.length, maxOpenTrades: cfg.maxOpenTrades });
      }
      this.broadcast({ type: 'positions', positions: openPositions });
      return;
    }
    if (this.resting) {
      this.resting = false;
      this._log('info', `Slot freed (${openPositions.length}/${cfg.maxOpenTrades} open) — resuming scans.`);
      this.broadcast({ type: 'bot_resting', resting: false, openTrades: openPositions.length, maxOpenTrades: cfg.maxOpenTrades });
    }

    this._log('info', `Scanning ${watchPairs.length} pairs (watch) / ${tradePairSet.size} pairs (trade)...`);

    if (this.dailyTradeCount >= cfg.maxTradesPerDay) {
      this.broadcast({ type: 'scan_skip', reason: 'daily_limit' });
    }

    // ── Build signals for ALL watch pairs ──────────────────────────────
    const allSignals = [];
    for (const symbol of watchPairs) {
      try {
        const [klines, markPrice, fundingRate] = await Promise.all([
          this.binance.getKlines(symbol, '1h', 100),
          this.binance.getMarkPrice(symbol),
          this.binance.getFundingRate(symbol),
        ]);
        const sig = this.engine.analyse(symbol, klines, markPrice, fundingRate);
        if (sig) {
          allSignals.push({
            ...sig,
            klines,
            fundingRate,
            tradeable: tradePairSet.has(symbol), // flag: can the bot trade this?
          });
        }
      } catch (e) {
        this._log('error', `Signal ${symbol}: ${e.message}`);
      }
    }

    // Sort by probability descending for display
    allSignals.sort((a, b) => b.probability - a.probability);

    // Store display list (strip klines)
    this.allSignals = allSignals.map(({ klines, ...rest }) => rest);

    // Tradeable signals that meet minProbability
    const qualified = allSignals.filter(
      s => s.tradeable && s.probability >= cfg.minProbability
    );
    this.latestSignals = qualified.map(({ klines, ...rest }) => rest);

    // Broadcast all signals to frontend (includes tradeable flag)
    this.broadcast({ type: 'signals', signals: this.allSignals });
    this._log('info', 
      `Signals: ${this.allSignals.length} watched, ${qualified.length} qualified for trading`
    );

    // ── Execute trades (only qualified tradeable pairs) ─────────────────
    for (const sig of qualified) {
      if (!this.running || this.dailyTradeCount >= cfg.maxTradesPerDay) break;
      if (openPositions.length >= cfg.maxOpenTrades) break;
      if (openPositions.find(p => p.symbol === sig.symbol)) continue;
      if (sig.side === 'BUY'  && !cfg.allowLong)  continue;
      if (sig.side === 'SELL' && !cfg.allowShort) continue;

      let aiResult = null;
      let finalProbability = sig.probability; // fallback: technical score
      if (cfg.useAnthropicAnalysis) {
        aiResult = await this.anthropic.analyseSignal({
          symbol: sig.symbol, side: sig.side,
          probability: sig.probability, entryPrice: sig.markPrice,
          tpPct: cfg.takeProfitPct, slPct: cfg.stopLossPct,
          leverage: cfg.leverage, klines: sig.klines, fundingRate: sig.fundingRate,
          indicators: sig.indicators,
        });
        this.broadcast({ type: 'anthropic_analysis', symbol: sig.symbol, result: aiResult });

        if (aiResult) finalProbability = aiResult.probability;

        if (cfg.anthropicBlocksLowQuality && aiResult && !aiResult.approved) {
          this._log('info', `Claude blocked ${sig.symbol}: ${aiResult.reasoning}`);
          continue;
        }
        if (finalProbability < cfg.minProbability) {
          this._log('info', `Claude rated ${sig.symbol} at ${finalProbability}% — below min threshold, skipping`);
          continue;
        }
      }

      const { availableBalance } = await this.binance.getBalance();
      const usd = cfg.tradeMode === 'pct'
        ? availableBalance * (cfg.tradeAmountPct / 100)
        : cfg.tradeAmountUsd;
      const qty = this.calcQuantity(usd, sig.markPrice, cfg.leverage);
      const tp  = aiResult?.adjustedTp ?? cfg.takeProfitPct;
      const sl  = aiResult?.adjustedSl ?? cfg.stopLossPct;

      try {
        const order = await this.binance.placeOrder({
          symbol: sig.symbol, side: sig.side, quantity: qty,
          takeProfitPct: tp, stopLossPct: sl, leverage: cfg.leverage,
        });
        const trade = { ...order, anthropicAnalysis: aiResult, probability: finalProbability };
        this.tradeStore.add(trade);
        this.dailyTradeCount++;
        openPositions.push(order);
        this.broadcast({ type: 'trade_opened', trade });
        this._log('info', `Trade: ${sig.symbol} ${sig.side}`);
      } catch (e) {
        this._log('error', `Order failed ${sig.symbol}: ${e.message}`);
        this.broadcast({ type: 'trade_error', symbol: sig.symbol, error: e.message });
      }
    }

    this.broadcast({ type: 'positions', positions: openPositions });
  }

  async _reconcileTrades() {
    const localOpen = this.tradeStore.getOpen();

    let livePositions;
    try {
      livePositions = await this.binance.getOpenPositions();
    } catch (err) {
      if (!this.binance.isAuthIssueActive()) {
        this._log('warn', 'Reconcile skipped — could not confirm live positions: ' + err.message);
      }
      return;
    }

    await this._checkUnprotectedPositions(livePositions);

    if (!localOpen.length) return;

    const liveSymbols = new Set(livePositions.map(p => p.symbol));

    for (const trade of localOpen) {
      if (liveSymbols.has(trade.symbol)) continue;

      const fills = await this.binance.getUserTrades(trade.symbol, 20);
      const closingFills = fills.filter(f => f.time >= (trade.openedAt || 0));

      let closePrice = trade.entryPrice;
      let pnl = 0;
      if (closingFills.length) {
        closePrice = closingFills[0].price;
        pnl = closingFills.reduce((sum, f) => sum + f.realizedPnl, 0);
      }

      const closed = this.tradeStore.close(trade.orderId, closePrice, pnl);
      if (closed) {
        this.broadcast({ type: 'trade_closed', trade: closed });
        this._log('info', `Reconciled: ${trade.symbol} closed @ ${closePrice} PnL=${pnl}`);
      }
    }
  }

  async _checkUnprotectedPositions(livePositions) {
    if (!this._warnedUnprotected) this._warnedUnprotected = new Set();

    // Drop warn-state for symbols no longer open, so a future position on
    // the same symbol gets a fresh warning if it ever becomes unprotected.
    const liveSymbols = new Set(livePositions.map(p => p.symbol));
    for (const key of [...this._warnedUnprotected]) {
      if (!liveSymbols.has(key.replace('unprotected_warned_', ''))) {
        this._warnedUnprotected.delete(key);
      }
    }

    for (const pos of livePositions) {
      const key = `unprotected_warned_${pos.symbol}`;
      try {
        const orders  = await this.binance.getOpenAlgoOrders(pos.symbol);
        const hasStop = orders.some(o => o.type === 'STOP_MARKET' || o.type === 'STOP');

        if (hasStop) {
          this._warnedUnprotected.delete(key); // protected now — allow a fresh warning if it drops again later
          continue;
        }

        // Missing SL — try to self-heal once before alarming, using the
        // configured stopLossPct against the position's real entry price.
        const stopLossPct = this.settings.get('stopLossPct') || 1.5;
        const healed = await this.binance.protectPosition(pos, stopLossPct);

        if (healed?.placed) {
          this._log('info', `Auto-healed missing stop-loss for ${pos.symbol} @ ${healed.slPrice}`);
          this._warnedUnprotected.delete(key);
          continue;
        }

        // Self-heal failed too — alarm once, don't repeat every scan cycle.
        if (!this._warnedUnprotected.has(key)) {
          this._log('error', `UNPROTECTED POSITION: ${pos.symbol} has no stop-loss order on Binance and auto-heal failed — PnL ${pos.unrealizedPnl}. Manual review recommended.`);
          this.broadcast({ type: 'unprotected_position', symbol: pos.symbol, unrealizedPnl: pos.unrealizedPnl });
          this._warnedUnprotected.add(key);
        }
      } catch (err) {
        this._log('warn', `Could not check protection for ${pos.symbol}: ${err.message}`);
      }
    }
  }

  calcQuantity(usdAmount, price, leverage) {
    const notional = usdAmount * leverage;
    return Math.floor((notional / price) * 1000) / 1000;
  }

  async _broadcastPrices() {
    try {
      const prices = await this.binance.getAllMarkPrices();
      const watchPairs  = this.settings.get('watchPairs') || this.settings.get('pairs') || [];
      const tradePairs  = this.settings.get('pairs') || [];
      const openSymbols = this.tradeStore.getOpen().map(t => t.symbol);
      const wanted = new Set([...watchPairs, ...tradePairs, ...openSymbols]);
      const filtered = {};
      wanted.forEach(s => { if (prices[s]) filtered[s] = prices[s]; });
      if (Object.keys(filtered).length) this.broadcast({ type: 'prices', prices: filtered });
    } catch { /* silent */ }
  }

  async _broadcastBalance() {
    try {
      const balance = await this.binance.getBalance();
      this.broadcast({ type: 'balance', balance });
    } catch { /* silent */ }
  }

  async _broadcastPositions() {
    try {
      const positions = await this.binance.getOpenPositions();
      this.broadcast({ type: 'positions', positions });
    } catch { /* silent */ }
  }

  _resetDaily() {
    const today = new Date().toDateString();
    if (today !== this.lastDayReset) {
      this.dailyTradeCount = 0;
      this.lastDayReset = today;
    }
  }
}

module.exports = { TradingBot };
