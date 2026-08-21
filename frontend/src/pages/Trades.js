import React, { useState, useEffect, useCallback } from 'react';

export default function Trades({ prices = {} }) {
  const [trades, setTrades]   = useState([]);
  const [view,   setView]     = useState('open');
  const [closing, setClosing] = useState(null); // orderId currently closing, or null
  const [confirmId, setConfirmId] = useState(null); // orderId awaiting confirmation
  const [error, setError]     = useState(null);

  const load = useCallback(() => {
    fetch(`/api/trades/${view}`).then(r => r.json()).then(setTrades).catch(() => {});
  }, [view]);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const closeTrade = async (orderId) => {
    setClosing(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/trades/${orderId}/close`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to close trade');
      setConfirmId(null);
      load(); // refresh from server so PnL/status reflect the real close
    } catch (err) {
      setError(`${orderId}: ${err.message}`);
    } finally {
      setClosing(null);
    }
  };

  return (
    <div className="page">
      <div className="page-hdr">
        <h2>Trades</h2>
        <div className="pills">
          {['open','closed'].map(v => (
            <button key={v} className={`pill ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ color: '#ef5266', fontSize: 13, marginBottom: 10 }}>
          Could not close trade {error}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Symbol</th><th>Side</th><th>Entry $</th><th>Current $</th><th>TP $</th><th>SL $</th><th>Lev</th><th>Prob</th><th>PNL</th><th>Status</th><th>Opened</th><th></th></tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr><td colSpan="12" style={{ textAlign: 'center', padding: '2rem', color: '#8892a4' }}>No {view} trades</td></tr>
            )}
            {trades.map(t => {
              const isOpen     = (t.status || '').toUpperCase() === 'OPEN';
              const live       = prices[t.symbol]?.price;
              const entryPrice = +t.entryPrice || 0;
              const isLong     = t.side === 'BUY';
              const favorable  = live != null && (isLong ? live >= entryPrice : live <= entryPrice);
              const isClosing  = closing === t.orderId;
              const isConfirming = confirmId === t.orderId;

              return (
                <tr key={t.id || t.orderId}>
                  <td><strong>{t.symbol}</strong></td>
                  <td><span className={`dir ${isLong ? 'long' : 'short'}`}>{isLong ? 'LONG' : 'SHORT'}</span></td>
                  <td>${entryPrice.toLocaleString()}</td>
                  <td className={isOpen && live != null ? (favorable ? 'green' : 'red') : ''}>
                    {isOpen ? (live != null ? `$${(+live).toLocaleString()}` : '—') : (t.closePrice != null ? `$${(+t.closePrice).toLocaleString()}` : '—')}
                  </td>
                  <td className="green">${(+t.tpPrice || 0).toLocaleString()}</td>
                  <td className="red">${(+t.slPrice || 0).toLocaleString()}</td>
                  <td>{t.leverage || '—'}x</td>
                  <td>{t.probability || '—'}%</td>
                  <td className={t.pnl >= 0 ? 'green' : 'red'}>{t.pnl != null ? `$${(+t.pnl).toFixed(2)}` : '—'}</td>
                  <td><span className={`status-badge ${(t.status||'').toLowerCase()}`}>{t.status}</span></td>
                  <td style={{ fontSize: 11, color: '#8892a4' }}>{t.openedAt ? new Date(t.openedAt).toLocaleString() : '—'}</td>
                  <td>
                    {isOpen && (
                      isConfirming ? (
                        <span style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn-close confirm"
                            disabled={isClosing}
                            onClick={() => closeTrade(t.orderId)}
                          >
                            {isClosing ? 'Closing…' : 'Confirm'}
                          </button>
                          <button className="btn-trade" disabled={isClosing} onClick={() => setConfirmId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="btn-close" onClick={() => setConfirmId(t.orderId)}>Close</button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
