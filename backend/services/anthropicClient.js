const axios = require('axios');
const { logger } = require('../utils/logger');

// Final-decision AI layer. Replaces GrokClient. Unlike the old flow — where
// SignalEngine's technical score WAS the probability used to size/approve a
// trade — Claude now issues its own probability rating on top of the raw
// indicators, and that rating is what the bot actually trades on.
class AnthropicClient {
  constructor(apiKey) {
    this.apiKey  = (apiKey || '').trim();   // strip \r\n from Windows .env files
    this.model   = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5').trim();
    this.enabled = !!this.apiKey;
  }

  async _chat(system, userContent, opts = {}) {
    if (!this.enabled) return null;
    const body = {
      model:      this.model,
      system,
      messages:   [{ role: 'user', content: userContent }],
      max_tokens: opts.maxTokens ?? 600,
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

    try {
      const res = await axios.post('https://api.anthropic.com/v1/messages', body, {
        headers: {
          'x-api-key':         this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 20000,
      });
      return res.data.content?.[0]?.text?.trim() || null;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      // Some models reject a custom temperature outright. Retry once
      // without it rather than losing the whole call.
      if (/temperature/i.test(msg) && body.temperature !== undefined) {
        delete body.temperature;
        try {
          const res = await axios.post('https://api.anthropic.com/v1/messages', body, {
            headers: {
              'x-api-key':         this.apiKey,
              'anthropic-version': '2023-06-01',
              'content-type':      'application/json',
            },
            timeout: 20000,
          });
          return res.data.content?.[0]?.text?.trim() || null;
        } catch (err2) {
          logger.error('Anthropic error (retry without temperature also failed): ' + (err2.response?.data?.error?.message || err2.message));
          return null;
        }
      }
      logger.error('Anthropic error: ' + msg);
      return null;
    }
  }

  // Final decision AND probability rating for a candidate signal.
  // `probability` passed in is SignalEngine's raw technical score — sent to
  // Claude as context, not as the answer. Claude assigns its own 0-100
  // probability, which becomes the number actually used to size/approve
  // the trade downstream.
  //
  // Returns: {approved, probability, confidence, reasoning, riskLevel,
  //           adjustedTp, adjustedSl, sentiment}
  async analyseSignal({ symbol, side, probability, entryPrice, tpPct, slPct, leverage, klines = [], fundingRate = 0, indicators = {} }) {
    const candles = klines.slice(-15).map(k => `C:${k.close}`).join(' ');
    const system =
      'You are a Binance Futures trading analyst. You independently rate the probability ' +
      'that a proposed trade will hit take-profit before stop-loss, using the technical ' +
      'indicators and candles given. Do not just repeat the technical score you are given — ' +
      'form your own judgment from the raw indicators. Reply ONLY with valid JSON — ' +
      'no markdown, no extra text, no code fences:\n' +
      '{"approved":true|false,"probability":0-100,"confidence":0-100,"reasoning":"max 100 chars",' +
      '"riskLevel":"low"|"medium"|"high","adjustedTp":null,"adjustedSl":null,' +
      '"sentiment":"bullish"|"bearish"|"neutral"}';

    const ind = indicators || {};
    const userContent =
      `Proposed trade: ${symbol} ${side} @ $${entryPrice} | TP:${tpPct}% SL:${slPct}% | ${leverage}x lev\n` +
      `Technical (pre-filter, informational only) score: ${probability}%\n` +
      `Indicators: RSI:${ind.rsi ?? '?'} StochRSI:${ind.stochRsi ?? '?'} ADX:${ind.adx ?? '?'} ` +
      `MACD-hist:${ind.macdHistogram ?? '?'} BBwidth:${ind.bbWidth ?? '?'} VolSpike:${ind.volumeSpike ?? '?'} ` +
      `EMA9:${ind.ema9 ?? '?'} EMA21:${ind.ema21 ?? '?'} EMA50:${ind.ema50 ?? '?'} EMA200:${ind.ema200 ?? '?'}\n` +
      `Funding rate: ${(fundingRate * 100).toFixed(4)}%\n` +
      `Recent candles: ${candles}\n` +
      `Rate this trade's probability of success and decide whether to approve it.`;

    const raw = await this._chat(system, userContent, { temperature: 0.2, maxTokens: 300 });
    if (!raw) {
      return {
        approved: true, probability, confidence: probability,
        reasoning: 'Anthropic unavailable — using technical score',
        riskLevel: 'medium', adjustedTp: null, adjustedSl: null, sentiment: 'neutral',
      };
    }
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('no JSON found in response');
      const parsed = JSON.parse(match[0]);
      // Guard against a missing/out-of-range probability from the model.
      if (typeof parsed.probability !== 'number' || parsed.probability < 0 || parsed.probability > 100) {
        parsed.probability = probability;
      }
      if (typeof parsed.confidence !== 'number') parsed.confidence = parsed.probability;
      return parsed;
    } catch {
      return {
        approved: true, probability, confidence: probability,
        reasoning: 'Parse error — using technical score',
        riskLevel: 'medium', adjustedTp: null, adjustedSl: null, sentiment: 'neutral',
      };
    }
  }

  // Free-text market overview.
  async analyseMarket(prices, openPositions = []) {
    const pStr = Object.entries(prices).slice(0, 7)
      .map(([s, d]) => `${s}: $${d.price} (FR:${(d.fundingRate * 100).toFixed(4)}%)`).join('\n');
    const posStr = openPositions.length
      ? openPositions.map(p => `${p.symbol} ${p.side} PNL:$${p.unrealizedPnl?.toFixed(2)}`).join('\n')
      : 'None';

    const system = 'You are a professional crypto futures analyst. Give a 3-4 sentence market overview with current bias, key risks, and actionable outlook.';
    const userContent = `Prices:\n${pStr}\n\nOpen positions:\n${posStr}\n\nGive market outlook.`;

    return await this._chat(system, userContent, { temperature: 0.5, maxTokens: 300 });
  }
}

module.exports = { AnthropicClient };
