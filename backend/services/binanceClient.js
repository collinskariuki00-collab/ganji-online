/**
 * Binance Futures REST client — pure axios, no third-party binance package.
 * Docs: https://binance-docs.github.io/apidocs/futures/en/
 */
const axios  = require('axios');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const BASE_MAIN = 'https://fapi.binance.com';

class BinanceClient {
  // Live trading only — the demo/testnet toggle was removed since it caused
  // key-mismatch confusion (keys saved for one mode, account switched to
  // the other). keyProvider: optional async () => { apiKey, apiSecret } | null.
  // Multi-tenant callers (botManager) pass a provider that reads the
  // client's own encrypted keys from Postgres. When omitted, falls back to
  // .env (single-tenant / local dev), preserving the original behaviour.
  constructor(keyProvider = null) {
    this.mode = 'live';
    this.testnet = false;
    this.connected = false;
    this.keyProvider = keyProvider;
    this._applyCredentials({ apiKey: '', apiSecret: '' }); // safe placeholder until _ready() resolves
    this._ready = this._applyCredentialsFromProvider();
  }

  // Must be awaited (or rely on the constructor's fire-and-forget _ready)
  // before the first request when using a keyProvider.
  async whenReady() { return this._ready; }

  async _applyCredentialsFromProvider() {
    if (!this.keyProvider) {
      this._applyCredentials({
        apiKey:    process.env.BINANCE_API_KEY    || '',
        apiSecret: process.env.BINANCE_API_SECRET || '',
      });
      return;
    }
    const creds = await this.keyProvider();
    this._applyCredentials(creds || { apiKey: '', apiSecret: '' });
  }

  _applyCredentials({ apiKey, apiSecret }) {
    this._authIssueLogged = false;
    const BASE = BASE_MAIN;

    this.apiKey    = (apiKey || '').trim();     // strip \r from Windows .env
    this.apiSecret = (apiSecret || '').trim();

    this.http = axios.create({
      baseURL: BASE,
      timeout: 20000,
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    logger.info(`Binance client: LIVE mode (${BASE})${this.apiKey ? '' : ' — no keys on file yet'}`);
  }

  // Re-reads keys from the provider (e.g. right after a client saves new
  // keys in Settings) without needing to recreate the whole bot instance.
  async refreshCredentials() {
    await this._applyCredentialsFromProvider();
    return { mode: 'live', hasKeys: !!(this.apiKey && this.apiSecret) };
  }

  getMode() {
    return { mode: this.mode, testnet: this.testnet, hasKeys: !!(this.apiKey && this.apiSecret) };
  }

  // ── Helpers ──────────────────────────────────────────────

  _sign(params) {
    const qs  = new URLSearchParams({ ...params, recvWindow: 10000, timestamp: Date.now() }).toString();
    const sig = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
    return qs + '&signature=' + sig;
  }

  async _get(path, params = {}, sign = false) {
    const url = sign ? `${path}?${this._sign(params)}` : path;
    try {
      const res = await this.http.get(url, sign ? {} : { params });
      if (sign) this._clearAuthIssue();
      return res.data;
    } catch (err) {
      err.message = this._describeError(err);
      this._maybeLogAuthIssue(err);
      throw err;
    }
  }

  async _post(path, params = {}) {
    try {
      const res = await this.http.post(`${path}?${this._sign(params)}`);
      this._clearAuthIssue();
      return res.data;
    } catch (err) {
      err.message = this._describeError(err);
      this._maybeLogAuthIssue(err);
      throw err;
    }
  }

  async _delete(path, params = {}) {
    try {
      const res = await this.http.delete(`${path}?${this._sign(params)}`);
      this._clearAuthIssue();
      return res.data;
    } catch (err) {
      err.message = this._describeError(err);
      this._maybeLogAuthIssue(err);
      throw err;
    }
  }

  // -2015 (bad key/IP/permission) tends to fire on every single request in
  // a row until the person fixes it on Binance's side — that's minutes or
  // hours of identical spam otherwise. Log one clear, actionable message
  // and go quiet until a signed request actually succeeds again.
  _maybeLogAuthIssue(err) {
    if (!/-2015/.test(err.message)) return;
    if (this._authIssueLogged) return;
    this._authIssueLogged = true;
    const ipMatch = err.message.match(/request ip:\s*([\d.]+)/i);
    const ip = ipMatch ? ipMatch[1] : 'unknown';
    logger.error(
      `Binance rejected the ${this.mode.toUpperCase()} API key (code -2015) — ` +
      `this is almost always an IP-whitelist mismatch or a missing permission, ` +
      `not a bug. Binance sees this request coming from IP ${ip}. Add that IP to ` +
      `the key's whitelist at binance.com/en/my/settings/api-management (or remove ` +
      `the IP restriction), and confirm "Futures" permission is enabled on the key. ` +
      `Further repeats of this error will be suppressed until it clears.`
    );
  }

  _clearAuthIssue() {
    if (this._authIssueLogged) {
      logger.info(`Binance ${this.mode.toUpperCase()} API connection restored.`);
      this._authIssueLogged = false;
    }
  }

  isAuthIssueActive() {
    return !!this._authIssueLogged;
  }

  // ── Public endpoints (no auth) ───────────────────────────

  async testConnection() {
    try {
      await this._get('/fapi/v1/ping');
      this.connected = true;
      logger.info('Binance Futures ping OK');
      return true;
    } catch (err) {
      logger.error('Binance connection failed: ' + err.message);
      return false;
    }
  }

  async getServerTime() {
    const data = await this._get('/fapi/v1/time');
    return data.serverTime;
  }

  // Mark price + funding rate for one or all symbols
  async getAllMarkPrices() {
    const data = await this._get('/fapi/v1/premiumIndex');
    const result = {};
    (Array.isArray(data) ? data : [data]).forEach(d => {
      result[d.symbol] = {
        price:       parseFloat(d.markPrice),
        fundingRate: parseFloat(d.lastFundingRate || 0),
      };
    });
    return result;
  }

  async getMarkPrice(symbol) {
    const data = await this._get('/fapi/v1/premiumIndex', { symbol });
    return parseFloat(data.markPrice);
  }

  // OHLCV klines
  async getKlines(symbol, interval = '1h', limit = 100) {
    const data = await this._get('/fapi/v1/klines', { symbol, interval, limit });
    return data.map(c => ({
      openTime: c[0],
      open:     parseFloat(c[1]),
      high:     parseFloat(c[2]),
      low:      parseFloat(c[3]),
      close:    parseFloat(c[4]),
      volume:   parseFloat(c[5]),
    }));
  }

  // Funding rate history
  async getFundingRate(symbol) {
    try {
      const data = await this._get('/fapi/v1/fundingRate', { symbol, limit: 1 });
      return parseFloat((Array.isArray(data) ? data[0] : data)?.fundingRate || 0);
    } catch { return 0; }
  }

  // ── Authenticated endpoints ──────────────────────────────

  async getBalance() {
    if (!this.apiKey) return { balance: 0, availableBalance: 0, unrealizedPnl: 0 };
    try {
      // Try /fapi/v2/balance first
      const data = await this._get('/fapi/v2/balance', {}, true);
      const usdt = (Array.isArray(data) ? data : [data]).find(a => a.asset === 'USDT');
      const bal  = parseFloat(usdt?.balance || 0);
      // Testnet sometimes returns all zeros on /balance — fallback to /account
      if (bal > 0) {
        return {
          balance:          bal,
          availableBalance: parseFloat(usdt?.availableBalance || 0),
          unrealizedPnl:    parseFloat(usdt?.crossUnPnl || usdt?.unrealizedProfit || 0),
        };
      }
    } catch { /* fall through */ }
    try {
      // Fallback: /fapi/v2/account (more reliable on testnet)
      const acc = await this._get('/fapi/v2/account', {}, true);
      return {
        balance:          parseFloat(acc.totalWalletBalance    || 0),
        availableBalance: parseFloat(acc.availableBalance      || 0),
        unrealizedPnl:    parseFloat(acc.totalUnrealizedProfit || 0),
      };
    } catch (err) {
      if (!this.isAuthIssueActive()) logger.error('getBalance error: ' + err.message);
      return { balance: 0, availableBalance: 0, unrealizedPnl: 0 };
    }
  }

  async setLeverage(symbol, leverage) {
    try {
      await this._post('/fapi/v1/leverage', { symbol, leverage });
      logger.info(`Leverage set: ${symbol} ${leverage}x`);
    } catch (err) {
      logger.warn(`setLeverage warning: ${err.message}`);
    }
  }

  async setMarginType(symbol, marginType = 'CROSSED') {
    try {
      await this._post('/fapi/v1/marginType', { symbol, marginType });
    } catch (err) {
      // -4046 = already set — safe to ignore
      if (!err.response?.data?.msg?.includes('No need')) {
        logger.warn(`setMarginType: ${err.message}`);
      }
    }
  }

  // ── Symbol precision (LOT_SIZE / PRICE_FILTER / MIN_NOTIONAL) ────
  // Binance rejects orders with HTTP 400 if quantity/price don't match
  // the exact step size for that symbol. We cache exchangeInfo and use
  // it to round correctly instead of guessing a fixed decimal count.

  async _getExchangeInfo() {
    if (this._exchangeInfoCache && Date.now() - this._exchangeInfoCacheTime < 3600_000) {
      return this._exchangeInfoCache;
    }
    const data = await this._get('/fapi/v1/exchangeInfo');
    this._exchangeInfoCache = data;
    this._exchangeInfoCacheTime = Date.now();
    return data;
  }

  async _getSymbolFilters(symbol) {
    const info = await this._getExchangeInfo();
    const sym = info.symbols.find(s => s.symbol === symbol);
    if (!sym) throw new Error(`Symbol ${symbol} not found in exchangeInfo`);
    const lotSize    = sym.filters.find(f => f.filterType === 'LOT_SIZE');
    const priceFilter = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
    const minNotional = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
    return {
      stepSize:    lotSize ? parseFloat(lotSize.stepSize) : 0.001,
      minQty:      lotSize ? parseFloat(lotSize.minQty)   : 0,
      tickSize:    priceFilter ? parseFloat(priceFilter.tickSize) : 0.01,
      minNotional: minNotional ? parseFloat(minNotional.notional) : 0,
      quantityPrecision: sym.quantityPrecision,
      pricePrecision:    sym.pricePrecision,
    };
  }

  // Round a raw quantity down to the symbol's allowed step size
  _roundToStep(value, step) {
    if (!step) return value;
    const precision = Math.max(0, Math.round(-Math.log10(step)));
    const rounded = Math.floor(value / step) * step;
    return +rounded.toFixed(precision);
  }

  _roundToTick(value, tick) {
    if (!tick) return value;
    const precision = Math.max(0, Math.round(-Math.log10(tick)));
    return +(Math.round(value / tick) * tick).toFixed(precision);
  }

  // Public helper: given a desired notional/leverage and current price,
  // returns a quantity that's valid for this symbol's precision rules.
  async calcValidQuantity(symbol, rawQuantity) {
    const filters = await this._getSymbolFilters(symbol);
    const qty = this._roundToStep(rawQuantity, filters.stepSize);
    if (qty < filters.minQty) {
      throw new Error(`Quantity ${qty} below minQty ${filters.minQty} for ${symbol}`);
    }
    return qty;
  }


  // Binance's immediate response to a MARKET order can come back with
  // avgPrice/price = "0" even though the order genuinely filled (a known
  // API quirk, more common on testnet). Trusting that 0 leads to TP/SL
  // prices of 0, which Binance rejects — and our safety logic interprets
  // a rejected SL as "unprotected, close immediately", causing trades to
  // open and close within the same second. So: never trust 0 here —
  // actively confirm the fill via a follow-up query before proceeding.
  async _resolveFillPrice(entry, symbol) {
    let price = parseFloat(entry.avgPrice || entry.price || 0);
    if (price > 0) return price;

    for (const delayMs of [300, 600, 1000]) {
      await new Promise(r => setTimeout(r, delayMs));
      try {
        const order = await this._get('/fapi/v1/order', { symbol, orderId: entry.orderId }, true);
        price = parseFloat(order.avgPrice || order.price || 0);
        if (price > 0) return price;
      } catch (err) {
        logger.warn(`Fill price lookup attempt failed for ${symbol}: ${this._describeError(err)}`);
      }
    }

    // Last resort: current mark price is close enough to a just-filled
    // market order, and is infinitely better than proceeding with 0.
    try {
      const markPrice = await this.getMarkPrice(symbol);
      if (markPrice > 0) {
        logger.warn(`Using mark price as fallback fill price for ${symbol} order ${entry.orderId}`);
        return markPrice;
      }
    } catch {}

    return 0;
  }

  async placeOrder({ symbol, side, quantity, takeProfitPct, stopLossPct, leverage }) {
    if (!this.apiKey) throw new Error('Binance API key not configured — add BINANCE_API_KEY to .env');

    await this.setLeverage(symbol, leverage);
    await this.setMarginType(symbol, 'CROSSED');

    const isLong    = side === 'BUY';
    const closeSide = isLong ? 'SELL' : 'BUY';

    const filters = await this._getSymbolFilters(symbol);
    let qty = this._roundToStep(quantity, filters.stepSize);
    if (qty <= 0 || qty < filters.minQty) {
      throw new Error(`Invalid quantity ${qty} for ${symbol} (min ${filters.minQty}, step ${filters.stepSize})`);
    }

    // Binance rejects any order whose notional (qty * price) is below its
    // exchange-wide MIN_NOTIONAL floor (currently $5), regardless of the
    // trade amount configured in the bot. Rather than let the order fail
    // outright, bump the quantity up just enough to clear it — this only
    // ever increases size, never shrinks below what was requested. A 1%
    // buffer absorbs price movement between this estimate and the fill.
    const minNotional = Math.max(filters.minNotional || 0, 5);
    try {
      const priceEstimate = await this.getMarkPrice(symbol);
      if (priceEstimate > 0) {
        const notional = qty * priceEstimate;
        if (notional < minNotional) {
          const bumpedQty = this._roundToStep((minNotional * 1.01) / priceEstimate, filters.stepSize);
          if (bumpedQty > qty) {
            logger.warn(`${symbol}: order notional $${notional.toFixed(2)} below Binance's $${minNotional} minimum — bumping quantity ${qty} → ${bumpedQty}`);
            qty = bumpedQty;
          }
        }
      }
    } catch (err) {
      logger.warn(`Could not pre-check notional for ${symbol}: ${err.message} — proceeding with original quantity`);
    }

    // Market entry
    let entry;
    try {
      entry = await this._post('/fapi/v1/order', {
        symbol,
        side,
        type:     'MARKET',
        quantity: String(qty),
      });
    } catch (err) {
      throw new Error(this._describeError(err));
    }

    const entryPrice = await this._resolveFillPrice(entry, symbol);
    if (!entryPrice || entryPrice <= 0) {
      // We genuinely cannot determine what price we filled at, even after
      // retries and a mark-price fallback. Rather than leave a real position
      // open on Binance with no way to compute TP/SL, close it immediately —
      // and still record what happened, since the entry order DID execute.
      logger.error(`Could not determine fill price for ${symbol} (order ${entry.orderId}) — closing position immediately, cannot set TP/SL`);
      let safetyClosed = false;
      try {
        await this._post('/fapi/v1/order', {
          symbol, side: closeSide,
          type: 'MARKET',
          quantity: String(qty),
          reduceOnly: 'true',
        });
        safetyClosed = true;
      } catch (closeErr) {
        logger.error(`URGENT: failed to safety-close ${symbol} after unresolvable fill price: ${this._describeError(closeErr)} — check Binance manually now`);
      }
      return {
        orderId: String(entry.orderId || Date.now()),
        symbol, side, quantity: qty,
        entryPrice: 0, tpPrice: 0, slPrice: 0, leverage,
        tpPlaced: false, slPlaced: false,
        status: safetyClosed ? 'CLOSED' : 'OPEN',
        note: safetyClosed
          ? 'Safety-closed: fill price could not be determined'
          : 'UNPROTECTED: fill price unknown and safety-close failed — check Binance manually',
        openedAt: Date.now(),
        ...(safetyClosed ? { closePrice: 0, pnl: 0, closedAt: Date.now() } : {}),
      };
    }

    const rawTp = isLong
      ? entryPrice * (1 + takeProfitPct / 100)
      : entryPrice * (1 - takeProfitPct / 100);
    const rawSl = isLong
      ? entryPrice * (1 - stopLossPct / 100)
      : entryPrice * (1 + stopLossPct / 100);

    const tpPrice = this._roundToTick(rawTp, filters.tickSize);
    const slPrice = this._roundToTick(rawSl, filters.tickSize);

    // Cancel any existing algo orders (TP/SL) for this symbol before placing
    // new ones. Binance returns -4130 if a GTE closePosition order already
    // exists in the same direction — this happens when a prior position on
    // the same symbol left orphaned orders, or on testnet where orders
    // persist across sessions. Cancelling first guarantees a clean slate.
    try {
      await this._delete('/fapi/v1/algoOpenOrders', { symbol });
    } catch (err) {
      // -4754 = no algo orders to cancel — that's fine, carry on
      const desc = this._describeError(err);
      if (!desc.includes('-4754') && !desc.includes('4754')) {
        logger.warn(`Could not clear algo orders for ${symbol} before TP/SL: ${desc}`);
      }
    }

    // Helper: try placing a protective order, with one retry on failure.
    // NOTE: as of Binance's 2025-12-09 API migration, conditional orders
    // (STOP_MARKET / TAKE_PROFIT_MARKET) must go through the Algo Order
    // API (/fapi/v1/algoOrder) instead of the old /fapi/v1/order endpoint.
    // The old endpoint now rejects them with error -4120. The Algo API
    // also renames `stopPrice` to `triggerPrice` and requires `algoType`.
    const tryPlaceProtective = async (type, triggerPrice, label) => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await this._post('/fapi/v1/algoOrder', {
            algoType:      'CONDITIONAL',
            symbol, side: closeSide,
            type,
            triggerPrice:  String(triggerPrice),
            closePosition: 'true',
            workingType:   'MARK_PRICE',
            timeInForce:   'GTC',
          });
          return true;
        } catch (err) {
          const desc = this._describeError(err);
          logger.warn(`${label} order attempt ${attempt} failed for ${symbol}: ${desc}`);
          if (attempt === 2) return false;
        }
      }
      return false;
    };

    const tpOk = await tryPlaceProtective('TAKE_PROFIT_MARKET', tpPrice, 'TP');
    const slOk = await tryPlaceProtective('STOP_MARKET', slPrice, 'SL');

    // A position with NO stop-loss is unprotected against unlimited downside.
    // If we genuinely cannot place a stop after retrying, close the position
    // immediately rather than leave it exposed. Either way — closed safely,
    // or left open because even the safety-close failed — the trade DID
    // execute on Binance and must be recorded. We never throw past this
    // point; throwing here would make the bot "forget" a real position
    // that exists on the exchange, breaking the dashboard/trade history.
    let status = 'OPEN';
    let closeNote = null;

    if (!slOk) {
      logger.error(`SL could not be placed for ${symbol} after retries — closing position immediately for safety`);
      try {
        await this._post('/fapi/v1/order', {
          symbol, side: closeSide,
          type: 'MARKET',
          quantity: String(qty),
          reduceOnly: 'true',
        });
        status = 'CLOSED';
        closeNote = 'Safety-closed: stop-loss could not be placed';
        logger.warn(`${symbol} safety-closed immediately after entry (no SL available)`);
      } catch (closeErr) {
        closeNote = 'UNPROTECTED: stop-loss and safety-close both failed — check Binance manually';
        logger.error(`URGENT: failed to safety-close unprotected ${symbol} position: ${this._describeError(closeErr)} — check Binance manually now`);
      }
    } else if (!tpOk) {
      logger.warn(`${symbol} is protected by SL but TP order failed — position will only close on stop-loss or manual action`);
    }

    logger.info(`Order placed: ${side} ${symbol} qty=${qty} entry=${entryPrice} TP=${tpPrice}${tpOk ? '' : '(failed)'} SL=${slPrice}${slOk ? '' : '(failed)'} status=${status}`);

    return {
      orderId:    String(entry.orderId || Date.now()),
      symbol, side, quantity: qty,
      entryPrice, tpPrice, slPrice, leverage,
      tpPlaced: tpOk, slPlaced: slOk,
      status,
      note: closeNote,
      openedAt: Date.now(),
      ...(status === 'CLOSED' ? { closePrice: entryPrice, pnl: 0, closedAt: Date.now() } : {}),
    };
  }

  // Binance returns {code, msg} in the response body on 4xx errors —
  // axios's err.message is just "Request failed with status code 400"
  // unless we dig into err.response.data ourselves. Network-level failures
  // (DNS, connection refused, timeout) have no response body at all.
  _describeError(err) {
    const data = err.response?.data;
    if (data?.code !== undefined) return `[${data.code}] ${data.msg}`;
    if (err.code === 'ENOTFOUND') return `Cannot reach Binance host (DNS lookup failed for ${err.hostname || 'the API host'}) — check your internet connection`;
    if (err.code === 'ECONNREFUSED') return 'Binance refused the connection — the API host may be down or blocking this request';
    if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message)) return 'Binance request timed out — the testnet API may be slow or unreachable right now';
    return err.message;
  }

  // Real fills for a symbol (most recent first), used to reconcile closed trades
  async getUserTrades(symbol, limit = 20) {
    if (!this.apiKey) return [];
    try {
      const data = await this._get('/fapi/v1/userTrades', { symbol, limit }, true);
      return (Array.isArray(data) ? data : [])
        .map(t => ({
          symbol:     t.symbol,
          price:      parseFloat(t.price),
          qty:        parseFloat(t.qty),
          realizedPnl: parseFloat(t.realizedPnl || 0),
          side:       t.side,
          time:       t.time,
          orderId:    String(t.orderId),
        }))
        .sort((a, b) => b.time - a.time);
    } catch (err) {
      logger.error(`getUserTrades ${symbol} error: ${err.message}`);
      return [];
    }
  }

  async getOpenOrders(symbol) {
    if (!this.apiKey) return [];
    const params = symbol ? { symbol } : {};
    const data = await this._get('/fapi/v1/openOrders', params, true);
    return Array.isArray(data) ? data : [];
  }

  // TP/SL (STOP_MARKET / TAKE_PROFIT_MARKET) now live in the Algo Order
  // system as of Binance's 2025-12-09 migration — they no longer appear
  // in /fapi/v1/openOrders. Use this to check for real protective orders.
  async getOpenAlgoOrders(symbol) {
    if (!this.apiKey) return [];
    const params = symbol ? { symbol } : {};
    const data = await this._get('/fapi/v1/openAlgoOrders', params, true);
    const list = Array.isArray(data) ? data : (data?.algoOrders || []);
    return list.map(o => ({ ...o, type: o.orderType || o.type })); // normalize field name
  }

  async getOpenPositions() {
    if (!this.apiKey) return [];
    const data = await this._get('/fapi/v2/positionRisk', {}, true); // let errors throw — caller must know if this failed
    return (Array.isArray(data) ? data : [])
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => ({
        symbol:           p.symbol,
        side:             parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
        quantity:         Math.abs(parseFloat(p.positionAmt)),
        entryPrice:       parseFloat(p.entryPrice),
        markPrice:        parseFloat(p.markPrice),
        unrealizedPnl:    parseFloat(p.unRealizedProfit),
        leverage:         parseInt(p.leverage),
        liquidationPrice: parseFloat(p.liquidationPrice),
      }));
  }

  // Self-heal: place a missing stop-loss on a position that's already open
  // on Binance (e.g. left over from before this safety logic existed, or an
  // SL that failed at entry time and slipped through). Computes the SL off
  // the position's actual entry price, not a fresh market price.
  async protectPosition(pos, stopLossPct) {
    const filters   = await this._getSymbolFilters(pos.symbol);
    const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
    const rawSl = pos.side === 'LONG'
      ? pos.entryPrice * (1 - stopLossPct / 100)
      : pos.entryPrice * (1 + stopLossPct / 100);
    const slPrice = this._roundToTick(rawSl, filters.tickSize);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this._post('/fapi/v1/algoOrder', {
          algoType:      'CONDITIONAL',
          symbol:        pos.symbol,
          side:          closeSide,
          type:          'STOP_MARKET',
          triggerPrice:  String(slPrice),
          closePosition: 'true',
          workingType:   'MARK_PRICE',
          timeInForce:   'GTC',
        });
        return { placed: true, slPrice };
      } catch (err) {
        logger.warn(`Auto-heal SL attempt ${attempt} failed for ${pos.symbol}: ${this._describeError(err)}`);
        if (attempt === 2) return { placed: false, slPrice };
      }
    }
  }

  // Manually close an open position: cancel its TP/SL algo orders first
  // (so they can't fire on a position that's about to be gone — Binance
  // would otherwise reject them anyway once quantity no longer matches),
  // then market-close, then return the real fill price/PnL from the trade
  // that just happened, not an estimate.
  async closePosition(symbol) {
    if (!this.apiKey) throw new Error('Binance API key not configured — add BINANCE_API_KEY to .env');

    const positions = await this.getOpenPositions();
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) throw new Error(`No open position found for ${symbol} on Binance`);

    try {
      await this._delete('/fapi/v1/algoOpenOrders', { symbol });
    } catch (err) {
      // Not fatal — proceed with the close even if there was nothing to cancel
      // or the cancel call itself failed; the position close is what matters.
      logger.warn(`Could not cancel algo orders for ${symbol} before closing: ${this._describeError(err)}`);
    }

    const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
    let closeOrder;
    try {
      closeOrder = await this._post('/fapi/v1/order', {
        symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: String(pos.quantity),
        reduceOnly: 'true',
      });
    } catch (err) {
      throw new Error(this._describeError(err));
    }

    const closePrice = await this._resolveFillPrice(closeOrder, symbol);

    // Pull the real realized PnL from the fill(s) that just happened,
    // rather than estimating from entry/close price (fees, funding, and
    // partial fills make that estimate unreliable).
    let pnl = 0;
    try {
      const fills = await this.getUserTrades(symbol, 10);
      const justNow = fills.filter(f => f.orderId === String(closeOrder.orderId));
      pnl = justNow.reduce((sum, f) => sum + f.realizedPnl, 0);
    } catch (err) {
      logger.warn(`Could not fetch realized PnL for ${symbol} close: ${err.message}`);
    }

    logger.info(`Position closed: ${symbol} ${closeSide} qty=${pos.quantity} closePrice=${closePrice || 'unknown'} pnl=${pnl}`);

    return {
      symbol,
      closePrice: closePrice || pos.markPrice,
      pnl,
      closedAt: Date.now(),
    };
  }
}

module.exports = { BinanceClient };
