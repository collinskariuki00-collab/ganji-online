import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','ADAUSDT','DOGEUSDT'];

const fmtPrice = (sym, p) => {
  if (!p) return '—';
  return p >= 1000 ? '$' + p.toLocaleString(undefined,{maximumFractionDigits:0})
       : p >= 1    ? '$' + p.toFixed(2)
       : '$' + p.toFixed(5);
};

export default function Dashboard({ prices, positions: wsPositions, signals, anthropicAnalysis, balance: wsBal }) {
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [balance,  setBalance]  = useState(null);
  const [restPositions, setRestPositions] = useState([]);

  useEffect(() => {
    fetch('/api/stats', { credentials: 'include' }).then(r => r.json()).then(setStats).catch(() => {});
    fetch('/api/balance', { credentials: 'include' }).then(r => r.json()).then(setBalance).catch(() => {});

    // Live positions exist on Binance regardless of whether the bot is
    // running — the websocket only pushes them while the bot's timers are
    // active, so poll separately to catch positions while it's stopped.
    const loadPositions = () => fetch('/api/positions', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setRestPositions(Array.isArray(d) ? d : []))
      .catch(() => {});
    loadPositions();
    const id = setInterval(loadPositions, 10000);
    return () => clearInterval(id);
  }, []);

  // Keep balance in sync with live WS updates
  useEffect(() => {
    if (wsBal) setBalance(wsBal);
  }, [wsBal]);

  // Prefer the more frequent websocket feed when the bot is actively
  // pushing it; fall back to the REST poll otherwise (e.g. bot stopped).
  const positions = (Array.isArray(wsPositions) && wsPositions.length) ? wsPositions : (Array.isArray(restPositions) ? restPositions : []);

  // Probability score is always visible on the dashboard (even for
  // non-subscribers) — it's the teaser that sells the Signals/Bot plan.
  const probBySymbol = Object.fromEntries((signals || []).map(s => [s.symbol, s.probability]));

  const runAnthropic = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/anthropic/market-analysis', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      setAnalysis(d.analysis || d.error);
    } catch { setAnalysis('Failed to reach Anthropic API — check .env'); }
    setLoading(false);
  };

  const openPnl = (positions || []).reduce((s, p) => s + (p.unrealizedPnl || 0), 0);

  return (
    <div className="page">
      {/* Price strip */}
      <div className="price-strip">
        {SYMBOLS.map(sym => {
          const d = prices?.[sym];
          const prob = probBySymbol[sym];
          const probColor = prob >= 75 ? '#22c55e' : prob >= 55 ? '#f59e0b' : '#94a3b8';
          return (
            <div key={sym} className="price-card">
              <div className="pc-sym">{sym.replace('USDT','')}/USDT</div>
              <div className="pc-val">{fmtPrice(sym, d?.price)}</div>
              <div className="pc-fr" style={{ color: (d?.fundingRate || 0) > 0 ? '#f59e0b' : '#22c55e' }}>
                FR: {d ? (d.fundingRate * 100).toFixed(4) + '%' : '—'}
              </div>
              {prob !== undefined && (
                <div className="pc-prob" style={{ color: probColor }}>
                  📊 {prob}%
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Balance cards */}
      <div className="balance-strip">
        <div className="bal-card accent">
          <div className="bal-icon">💰</div>
          <div>
            <div className="bal-lbl">Wallet Balance</div>
            <div className="bal-val">{balance ? '$' + balance.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} <span className="bal-unit">USDT</span></div>
          </div>
        </div>
        <div className="bal-card">
          <div className="bal-icon">🔓</div>
          <div>
            <div className="bal-lbl">Available Balance</div>
            <div className="bal-val">{balance ? '$' + balance.availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} <span className="bal-unit">USDT</span></div>
          </div>
        </div>
        <div className="bal-card">
          <div className="bal-icon">📈</div>
          <div>
            <div className="bal-lbl">Unrealized PNL</div>
            <div className={`bal-val ${(balance?.unrealizedPnl || 0) >= 0 ? 'green' : 'red'}`}>
              {balance ? (balance.unrealizedPnl >= 0 ? '+' : '') + '$' + balance.unrealizedPnl.toFixed(2) : '—'} <span className="bal-unit">USDT</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-grid">
        <div className="stat-card"><div className="s-lbl">Total PNL</div><div className={`s-val ${(stats?.totalPnl||0) >= 0 ? 'green' : 'red'}`}>${(stats?.totalPnl||0).toFixed(2)}</div></div>
        <div className="stat-card"><div className="s-lbl">Unrealized PNL</div><div className={`s-val ${openPnl >= 0 ? 'green' : 'red'}`}>${openPnl.toFixed(2)}</div></div>
        <div className="stat-card"><div className="s-lbl">Open trades</div><div className="s-val">{stats?.open ?? '—'}</div></div>
        <div className="stat-card"><div className="s-lbl">Closed trades</div><div className="s-val">{stats?.closed ?? '—'}</div></div>
        <div className="stat-card"><div className="s-lbl">Win rate</div><div className="s-val green">{stats?.winRate ?? '—'}%</div></div>
        <div className="stat-card"><div className="s-lbl">W / L</div><div className="s-val">{stats?.wins ?? '—'} / {stats?.losses ?? '—'}</div></div>
      </div>

      {/* Anthropic panel */}
      <div className="anthropic-panel">
        <div className="gp-header">
          <span className="gp-icon">🧠</span>
          <strong>Claude AI market analysis</strong>
          <span className="claude-tag">Anthropic</span>
        </div>
        <div className={`gp-output ${loading ? 'dim' : ''}`}>
          {loading ? 'Analysing market conditions...'
           : anthropicAnalysis?.result?.reasoning || analysis
           || 'Click the button below to get a live Claude AI market overview.'}
        </div>
        {anthropicAnalysis && (
          <div className="gp-meta">
            {anthropicAnalysis.symbol && <span className="gp-sym">{anthropicAnalysis.symbol}</span>}
            {anthropicAnalysis.result?.sentiment && <span className={`gp-sent ${anthropicAnalysis.result.sentiment}`}>{anthropicAnalysis.result.sentiment}</span>}
            {anthropicAnalysis.result?.probability && <span className="gp-conf">{anthropicAnalysis.result.probability}% probability</span>}
            {anthropicAnalysis.result?.riskLevel && <span className={`gp-risk ${anthropicAnalysis.result.riskLevel}`}>Risk: {anthropicAnalysis.result.riskLevel}</span>}
          </div>
        )}
        <button className="btn-anthropic" onClick={runAnthropic} disabled={loading}>
          🧠 {loading ? 'Analysing...' : 'Analyse market now'}
        </button>
      </div>

      {/* PNL chart + positions */}
      <div className="row2">
        <div className="card">
          <div className="card-title">PNL history</div>
          {(stats?.pnlHistory || []).length === 0
            ? <div className="empty">No closed trades yet</div>
            : <ResponsiveContainer width="100%" height={200}>
                <LineChart data={(stats.pnlHistory||[]).map(d => ({ name: new Date(d.date).toLocaleDateString(), pnl: +(d.pnl||0).toFixed(2) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2f45" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8892a4' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#8892a4' }} />
                  <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2a2f45', color: '#e8eaf0' }} formatter={v => [`$${v}`, 'PNL']} />
                  <Line type="monotone" dataKey="pnl" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
          }
        </div>
        <div className="card">
          <div className="card-title">Open positions</div>
          {!(positions||[]).length
            ? <div className="empty">No open positions</div>
            : <table className="tbl">
                <thead><tr><th>Symbol</th><th>Side</th><th>Entry</th><th>PNL</th><th>Liq.</th></tr></thead>
                <tbody>{positions.map(p => (
                  <tr key={p.symbol}>
                    <td><strong>{p.symbol}</strong></td>
                    <td><span className={`dir ${p.side.toLowerCase()}`}>{p.side}</span></td>
                    <td>${(+p.entryPrice).toLocaleString()}</td>
                    <td className={p.unrealizedPnl >= 0 ? 'green' : 'red'}>${(+p.unrealizedPnl).toFixed(2)}</td>
                    <td className="red">${(+p.liquidationPrice).toLocaleString()}</td>
                  </tr>
                ))}</tbody>
              </table>
          }
        </div>
      </div>
    </div>
  );
}
