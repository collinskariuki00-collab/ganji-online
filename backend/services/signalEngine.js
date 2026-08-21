/**
 * SignalEngine v2
 *
 * Scoring is now directional-only: LONG indicators only add to L,
 * SHORT indicators only add to S. Volume/BB squeeze adds to both
 * but only if direction-confirming context exists.
 *
 * MAX_SCORE reflects the realistic ceiling of what can actually be
 * earned in a genuine trending setup, not the theoretical sum of
 * every condition firing at once (many are mutually exclusive).
 */
class SignalEngine {
  analyse(symbol, klines, markPrice, fundingRate = 0) {
    if (!klines || klines.length < 50) return null;

    const closes = klines.map(k => k.close);
    const highs  = klines.map(k => k.high);
    const lows   = klines.map(k => k.low);
    const vols   = klines.map(k => k.volume);

    const last  = arr => arr[arr.length - 1];
    const prev  = arr => arr[arr.length - 2];
    const prev2 = arr => arr[arr.length - 3];

    // ── Indicators ────────────────────────────────────────────────────────
    const rsiArr  = this._rsi(closes, 14);
    const ema9    = this._ema(closes, 9);
    const ema21   = this._ema(closes, 21);
    const ema50   = this._ema(closes, 50);
    const ema200  = this._ema(closes, 200);
    const macd    = this._macd(closes);
    const bb      = this._bb(closes);
    const stochK  = this._stochRsi(rsiArr, 14, 3);
    const volSpike = this._volSpike(vols);
    const atr     = this._atr(highs, lows, closes, 14);
    const adx     = this._adx(highs, lows, closes, 14);

    const rsi    = last(rsiArr);
    const e9     = last(ema9);
    const e21    = last(ema21);
    const e50    = last(ema50);
    const e200   = last(ema200);
    const price  = last(closes);
    const prevP  = prev(closes);
    const hist   = last(macd.histogram);
    const histP  = prev(macd.histogram);
    const histP2 = prev2(macd.histogram);
    const bbU    = last(bb.upper);
    const bbL    = last(bb.lower);
    const bbM    = last(bb.mid);
    const bbW    = bbU && bbL && bbM ? (bbU - bbL) / bbM : 0;
    const sk     = last(stochK);
    const skPrev = prev(stochK);
    const atrVal = last(atr);
    const adxVal = last(adx);

    let L = 0, S = 0;

    // ── RSI (max 28 pts) ──────────────────────────────────────────────────
    if      (rsi < 25) L += 28;       // deeply oversold
    else if (rsi < 35) L += 20;
    else if (rsi < 45) L += 10;
    else if (rsi < 52) L += 4;

    if      (rsi > 75) S += 28;       // deeply overbought
    else if (rsi > 65) S += 20;
    else if (rsi > 55) S += 10;
    else if (rsi > 48) S += 4;

    // ── Stochastic RSI (max 14 pts) ───────────────────────────────────────
    if (sk < 20 && sk > skPrev) L += 14; // turning up from oversold
    else if (sk < 30)           L += 7;
    if (sk > 80 && sk < skPrev) S += 14; // turning down from overbought
    else if (sk > 70)           S += 7;

    // ── EMA stack (max 20 pts) ────────────────────────────────────────────
    if (e9 > e21)  L += 8; else S += 8;
    if (e21 > e50) L += 7; else S += 7;
    if (e50 > e200) L += 5; else S += 5;

    // ── Price vs EMAs (max 15 pts) ────────────────────────────────────────
    if (price > e50)  L += 8; else S += 8;
    if (price > e200) L += 7; else S += 7;

    // ── MACD (max 20 pts) ─────────────────────────────────────────────────
    // Histogram direction + acceleration
    const macdTrendUp   = hist > 0 && hist > histP && histP > histP2;
    const macdTrendDown = hist < 0 && hist < histP && histP < histP2;
    const macdCrossUp   = hist > 0 && histP <= 0;  // fresh cross above zero
    const macdCrossDown = hist < 0 && histP >= 0;

    if      (macdCrossUp)   L += 20;
    else if (macdTrendUp)   L += 15;
    else if (hist > 0)      L += 7;

    if      (macdCrossDown) S += 20;
    else if (macdTrendDown) S += 15;
    else if (hist < 0)      S += 7;

    // ── Bollinger Bands (max 12 pts) ──────────────────────────────────────
    const bbSqueeze = bbW < 0.02; // low volatility → potential breakout
    if (price < bbL) L += 10;           // price below lower band
    else if (price < bbM) L += 4;       // below midline
    if (price > bbU) S += 10;
    else if (price > bbM) S += 4;
    if (bbSqueeze && hist > 0) L += 5; // squeeze + bullish MACD
    if (bbSqueeze && hist < 0) S += 5;

    // ── Volume (max 10 pts, directional confirmation only) ────────────────
    if (volSpike > 2.0) {
      // High volume confirms the dominant direction only
      if (price > prevP) L += 10;
      else               S += 10;
    } else if (volSpike > 1.5) {
      if (price > prevP) L += 6;
      else               S += 6;
    }

    // ── Trend strength via ADX (max 8 pts, multiplier effect) ────────────
    // ADX > 25 = trending, > 35 = strongly trending
    const trending  = adxVal > 25;
    const strongTrend = adxVal > 35;
    if (trending) {
      if (L > S) L += strongTrend ? 8 : 5;
      else       S += strongTrend ? 8 : 5;
    }

    // ── Candlestick momentum (max 8 pts) ─────────────────────────────────
    const bodyPct = Math.abs(price - prevP) / (atrVal || 1);
    if (bodyPct > 0.7 && price > prevP) L += 8; // strong bullish candle
    if (bodyPct > 0.7 && price < prevP) S += 8; // strong bearish candle

    // ── Funding rate (max 15 pts) ─────────────────────────────────────────
    // Positive funding = longs pay = bearish pressure = favour short
    if      (fundingRate >  0.003) S += 15;
    else if (fundingRate >  0.001) S += 8;
    if      (fundingRate < -0.003) L += 15;
    else if (fundingRate < -0.001) L += 8;

    // ── Normalise ─────────────────────────────────────────────────────────
    // Realistic max for a genuine trending setup: ~115 pts for the winning
    // side. Conditions are directional so the losing side can't cancel out
    // the winner beyond what the ambiguity filter handles.
    const MAX_SCORE = 115;
    const lProb = Math.min(97, Math.round((L / MAX_SCORE) * 100));
    const sProb = Math.min(97, Math.round((S / MAX_SCORE) * 100));

    // Require meaningful separation between directional scores.
    // Reduced from 15 → 10 so we don't kill borderline-but-valid setups.
    if (Math.abs(lProb - sProb) < 10) return null;

    const side = lProb >= sProb ? 'BUY' : 'SELL';
    const prob = Math.max(lProb, sProb);

    return {
      symbol, side, probability: prob, markPrice,
      indicators: {
        rsi:           +rsi.toFixed(2),
        stochRsi:      +sk.toFixed(2),
        ema9:          +e9.toFixed(4),
        ema21:         +e21.toFixed(4),
        ema50:         +e50.toFixed(4),
        ema200:        +e200.toFixed(4),
        adx:           +adxVal.toFixed(2),
        macdHistogram: +hist.toFixed(6),
        bbWidth:       +bbW.toFixed(4),
        volumeSpike:   +volSpike.toFixed(2),
        fundingRate,
      },
      generatedAt: Date.now(),
    };
  }

  // ── Technical Indicator implementations ──────────────────────────────────

  _rsi(closes, period = 14) {
    let ag = 0, al = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) ag += d; else al += Math.abs(d);
    }
    ag /= period; al /= period;
    const r = new Array(period).fill(50);
    r.push(100 - 100 / (1 + ag / (al || 1e-9)));
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      ag = (ag * (period - 1) + Math.max(d, 0))  / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
      r.push(100 - 100 / (1 + ag / (al || 1e-9)));
    }
    return r;
  }

  _stochRsi(rsiArr, period = 14, smooth = 3) {
    const stoch = rsiArr.map((_, i) => {
      if (i < period - 1) return 50;
      const window = rsiArr.slice(i - period + 1, i + 1);
      const lo = Math.min(...window);
      const hi = Math.max(...window);
      return hi === lo ? 50 : ((rsiArr[i] - lo) / (hi - lo)) * 100;
    });
    // Smooth with SMA
    return stoch.map((_, i) => {
      if (i < smooth - 1) return 50;
      return stoch.slice(i - smooth + 1, i + 1).reduce((a, b) => a + b, 0) / smooth;
    });
  }

  _ema(closes, p) {
    const k = 2 / (p + 1);
    return closes.reduce((acc, v, i) => {
      acc.push(i === 0 ? v : v * k + acc[i - 1] * (1 - k));
      return acc;
    }, []);
  }

  _macd(closes, fast = 12, slow = 26, sig = 9) {
    const ef = this._ema(closes, fast);
    const es = this._ema(closes, slow);
    const line = ef.map((v, i) => v - es[i]);
    const sl = this._ema(line.slice(slow - 1), sig);
    const histogram = line.slice(slow - 1 + sig - 1).map((v, i) => v - sl[i]);
    return { macdLine: line, signalLine: sl, histogram };
  }

  _bb(closes, p = 20, std = 2) {
    return closes.map((_, i) => {
      const sl  = closes.slice(Math.max(0, i - p + 1), i + 1);
      const mid = sl.reduce((a, b) => a + b, 0) / sl.length;
      const sd  = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / sl.length);
      return { mid, upper: mid + std * sd, lower: mid - std * sd };
    }).reduce((acc, v) => {
      acc.mid.push(v.mid); acc.upper.push(v.upper); acc.lower.push(v.lower);
      return acc;
    }, { mid: [], upper: [], lower: [] });
  }

  _atr(highs, lows, closes, period = 14) {
    const tr = highs.map((h, i) => {
      if (i === 0) return h - lows[i];
      return Math.max(h - lows[i], Math.abs(h - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
    });
    return tr.map((_, i) => {
      if (i < period) return tr.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
      return tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    });
  }

  _adx(highs, lows, closes, period = 14) {
    const dm = highs.map((h, i) => {
      if (i === 0) return { plus: 0, minus: 0 };
      const upMove   = h - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      return {
        plus:  upMove > downMove && upMove > 0   ? upMove   : 0,
        minus: downMove > upMove && downMove > 0 ? downMove : 0,
      };
    });
    const trArr = highs.map((h, i) => {
      if (i === 0) return h - lows[i];
      return Math.max(h - lows[i], Math.abs(h - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
    });

    const smTr   = this._ema(trArr, period);
    const smPlus = this._ema(dm.map(d => d.plus), period);
    const smMinus = this._ema(dm.map(d => d.minus), period);

    const diPlus  = smPlus.map((v, i)  => smTr[i] ? (v / smTr[i]) * 100 : 0);
    const diMinus = smMinus.map((v, i) => smTr[i] ? (v / smTr[i]) * 100 : 0);
    const dx = diPlus.map((p, i) => {
      const sum = p + diMinus[i];
      return sum ? (Math.abs(p - diMinus[i]) / sum) * 100 : 0;
    });
    return this._ema(dx, period);
  }

  _volSpike(vols) {
    const avg = vols.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
    return vols[vols.length - 1] / (avg || 1);
  }
}

module.exports = { SignalEngine };
