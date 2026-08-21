import React, { useState, useEffect } from 'react';

export default function Signals({ signals }) {
  const [minProb, setMinProb]   = useState(0);
  const [cfg, setCfg]           = useState({});
  const [filterMode, setFilter] = useState('all'); // 'all' | 'tradeable' | 'watch'

  useEffect(() => {
    fetch('/api/settings', { credentials: 'include' })
      .then(r => r.json())
      .then(s => {
        setCfg(s);
        setMinProb(0); // show everything by default; slider lets user narrow
      })
      .catch(() => {});
  }, []);

  // signals arrives already sorted by probability desc from the bot broadcast.
  // If the account has no active plan, this array is simply empty — scanning
  // never starts server-side for an unpaid account (see botManager).
  const visible = (signals || []).filter(s => {
    if (s.probability < minProb) return false;
    if (filterMode === 'tradeable') return s.tradeable;
    if (filterMode === 'watch')    return !s.tradeable;
    return true;
  });

  const trade = async (symbol, side) => {
    if (!window.confirm(`Execute ${side === 'BUY' ? 'LONG' : 'SHORT'} on ${symbol}?`)) return;
    try {
      const r = await fetch('/api/trades/manual', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, side }),
      });
      const d = await r.json();
      if (d.error) alert('Error: ' + d.error);
      else alert(`Order placed! Entry: $${d.entryPrice}`);
    } catch (e) {
      alert('Request failed: ' + e.message);
    }
  };

  const tradeableCount = (signals || []).filter(s => s.tradeable).length;
  const watchCount     = (signals || []).filter(s => !s.tradeable).length;
  const minTrade       = cfg.minProbability || 0;

  return (
    <div className="page">
      <div className="page-hdr">
        <h2>Live signals</h2>

        {(signals || []).length === 0 && (
          <div className="signals-lock-banner">
            <div>
              <strong>No signals yet.</strong>
              <p>If you just subscribed, the bot scans every {cfg.scanIntervalSeconds || 60}s — signals will appear shortly. If you haven't subscribed, visit Billing to activate a plan.</p>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={pill('#1e3a5f', '#60a5fa')}>📡 {(signals || []).length} total</span>
          <span style={pill('#14301e', '#4ade80')}>🎯 {tradeableCount} tradeable pairs</span>
          <span style={pill('#2d1f00', '#f59e0b')}>👁 {watchCount} watch-only</span>
          <span style={pill('#1e1b4b', '#a78bfa')}>⚡ bot trades ≥ {minTrade}%</span>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[['all', 'All pairs'], ['tradeable', '🎯 Tradeable'], ['watch', '👁 Watch-only']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              style={{
                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: filterMode === val ? '#3b82f6' : '#1e2435',
                color: filterMode === val ? '#fff' : '#8892a4',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Probability slider */}
        <div className="filter-row" style={{ alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 12, color: '#8892a4' }}>
            Min display: <strong style={{ color: '#e2e8f0' }}>{minProb}%</strong>
          </label>
          <input
            type="range" min="0" max="95" step="1" value={minProb}
            onChange={e => setMinProb(+e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </div>

      {visible.length === 0 && (signals || []).length > 0 ? (
        <div className="empty-box">No signals match current filters</div>
      ) : (
        visible.map(s => {
          const isTradeable   = s.tradeable;
          const meetsMinProb  = s.probability >= minTrade;
          const probColor     = s.probability >= 75 ? '#22c55e' : s.probability >= 55 ? '#f59e0b' : '#94a3b8';

          return (
            <div
              key={s.symbol + s.side}
              className="sig-row"
              style={{
                borderLeft: isTradeable
                  ? `3px solid ${meetsMinProb ? '#22c55e' : '#3b82f6'}`
                  : '3px solid #374151',
                opacity: isTradeable ? 1 : 0.72,
              }}
            >
              {/* Pair + price */}
              <div style={{ minWidth: 110 }}>
                <div className="sig-pair" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {s.symbol.replace('USDT', '/USDT')}
                  {isTradeable && (
                    <span title="Bot can trade this pair" style={badge(meetsMinProb ? '#22c55e22' : '#3b82f622', meetsMinProb ? '#22c55e' : '#60a5fa')}>
                      {meetsMinProb ? '🎯' : '📋'}
                    </span>
                  )}
                </div>
                <div className="sig-price">${(+s.markPrice).toLocaleString()}</div>
              </div>

              {/* Direction */}
              <span className={`dir ${s.side === 'BUY' ? 'long' : 'short'}`}>
                {s.side === 'BUY' ? 'LONG' : 'SHORT'}
              </span>

              {/* Probability bar */}
              <div style={{ textAlign: 'center', minWidth: 60 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: probColor }}>
                  {s.probability}%
                </div>
                <div style={{ height: 4, borderRadius: 2, background: '#1e2435', margin: '3px 0', width: 56 }}>
                  <div style={{
                    height: '100%', borderRadius: 2, width: `${s.probability}%`,
                    background: probColor, transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{ fontSize: 9, color: '#8892a4' }}>probability</div>
              </div>

              {/* Indicators */}
              <div style={{ fontSize: 11, color: '#8892a4', lineHeight: 1.7, minWidth: 130 }}>
                <div>RSI: <span style={{ color: s.indicators?.rsi < 35 ? '#22c55e' : s.indicators?.rsi > 65 ? '#f87171' : '#cbd5e1' }}>{s.indicators?.rsi}</span>
                  {' '}StochRSI: {s.indicators?.stochRsi?.toFixed(1)}</div>
                <div>ADX: <span style={{ color: (s.indicators?.adx ?? 0) > 35 ? '#f59e0b' : '#cbd5e1' }}>{s.indicators?.adx?.toFixed(1)}</span>
                  {' '}Vol: {s.indicators?.volumeSpike}x</div>
                <div>MACD: <span style={{ color: (s.indicators?.macdHistogram ?? 0) > 0 ? '#22c55e' : '#f87171' }}>{(s.indicators?.macdHistogram ?? 0) > 0 ? '▲' : '▼'}</span>
                  {' '}BBW: {s.indicators?.bbWidth?.toFixed(3)}</div>
                <div>FR: {s.indicators?.fundingRate
                  ? (s.indicators.fundingRate * 100).toFixed(4) + '%'
                  : '—'}
                </div>
              </div>

              {/* Trade button — only for tradeable pairs */}
              {isTradeable ? (
                <button className="btn-trade" onClick={() => trade(s.symbol, s.side)}>
                  Trade ↗
                </button>
              ) : (
                <div style={{ width: 72, textAlign: 'center', fontSize: 10, color: '#4b5563' }}>
                  watch only
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

const pill = (bg, color) => ({
  background: bg, color, padding: '3px 10px', borderRadius: 20,
  fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
});

const badge = (bg, color) => ({
  background: bg, color, borderRadius: 4, fontSize: 10,
  padding: '1px 4px', lineHeight: 1.4,
});
