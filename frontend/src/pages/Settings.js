import React, { useState, useEffect } from 'react';

// Master pairs list — this is the single source of truth for both what
// gets watched/scanned (backend watchPairs) and what's selectable here as
// tradeable (cfg.pairs). Anything checked below only trades if it's also
// in watchPairs, so keep the two in sync — expanding this list expands
// both automatically for anyone using the defaults.
const ALL_PAIRS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','OPUSDT','ARBUSDT','WIFUSDT',
  'SUIUSDT','1000PEPEUSDT','1000SHIBUSDT','1000BONKUSDT','JUPUSDT','TIAUSDT','INJUSDT','NEARUSDT','APTUSDT','STXUSDT',
  'FETUSDT','RENDERUSDT','WLDUSDT','ENAUSDT','EIGENUSDT','PYTHUSDT','NOTUSDT','POLUSDT','LTCUSDT','ATOMUSDT','FILUSDT',
  'SANDUSDT','MANAUSDT','AAVEUSDT','UNIUSDT','MKRUSDT','CRVUSDT',
  'TRXUSDT','ETCUSDT','XLMUSDT','HBARUSDT','VETUSDT','ALGOUSDT','DOTUSDT','GRTUSDT','CHZUSDT','DYDXUSDT','GALAUSDT',
  'THETAUSDT','ENSUSDT','IMXUSDT','GMTUSDT','APEUSDT','WOOUSDT','JASMYUSDT','STGUSDT','BCHUSDT','COMPUSDT','SUSHIUSDT',
  'EGLDUSDT','KSMUSDT','AXSUSDT','ENJUSDT','1INCHUSDT','ANKRUSDT','ROSEUSDT','FLOWUSDT','API3USDT','SNXUSDT','ZILUSDT',
];

// Trade amount steps: $1, then $5 increments up to $2000. Binance also
// enforces its own per-symbol MIN_NOTIONAL floor (usually ~$5-20), so a
// $1 order can still get rejected on some pairs — the bot logs that clearly
// if it happens.
const AMOUNT_STEPS = [1, ...Array.from({ length: 400 }, (_, i) => (i + 1) * 5)];

export default function Settings() {
  const [cfg,   setCfg]   = useState(null);
  const [saved, setSaved] = useState(false);
  const [keys,  setKeys]  = useState({ apiKey: '', apiSecret: '' });
  const [keyStatus, setKeyStatus] = useState({ hasKeys: false });
  const [keySaved, setKeySaved] = useState('');
  const [show,  setShow]  = useState({});

  useEffect(() => {
    fetch('/api/settings', { credentials: 'include' }).then(r => r.json()).then(setCfg).catch(() => {});
    fetch('/api/binance-keys/status', { credentials: 'include' }).then(r => r.json()).then(setKeyStatus).catch(() => {});
  }, []);

  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }));

  const togglePair = (p) => {
    const selected = cfg.pairs.includes(p);
    if (!selected && cfg.maxPairs !== null && cfg.pairs.length >= cfg.maxPairs) {
      alert(`Your plan allows up to ${cfg.maxPairs} tradeable pair${cfg.maxPairs === 1 ? '' : 's'}. Remove one first or upgrade in Billing.`);
      return;
    }
    set('pairs', selected ? cfg.pairs.filter(x => x !== p) : [...cfg.pairs, p]);
  };

  const save = async () => {
    const r = await fetch('/api/settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert(d.error || 'Failed to save settings'); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const reset = () => fetch('/api/settings/reset', { method: 'POST', credentials: 'include' }).then(r => r.json()).then(setCfg);

  const saveKeys = async () => {
    if (!keys.apiKey || !keys.apiSecret) return;
    const r = await fetch('/api/binance-keys', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: keys.apiKey, apiSecret: keys.apiSecret }),
    });
    if (r.ok) {
      setKeyStatus({ hasKeys: true });
      setKeys({ apiKey: '', apiSecret: '' });
      setKeySaved('✓ Saved');
      setTimeout(() => setKeySaved(''), 2000);
    } else {
      const d = await r.json().catch(() => ({}));
      setKeySaved('Error: ' + (d.error || 'failed to save'));
    }
  };

  if (!cfg) return <div className="page"><div className="empty">Loading settings...</div></div>;

  const Slider = ({ label, k, min, max, step = 1, fmt = v => v }) => (
    <div className="field">
      <label>{label} <strong>{fmt(cfg[k])}</strong></label>
      <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={e => set(k, +e.target.value)} />
    </div>
  );

  // Stepped slider over a fixed, non-uniform value list ($1, then $5, $10,
  // $15...) rather than a plain min/max/step range, since the first jump
  // (1 → 5) isn't a constant step.
  const AmountSlider = ({ label, k, values, fmt = v => v }) => {
    const idx = values.reduce((best, v, i) =>
      Math.abs(v - cfg[k]) < Math.abs(values[best] - cfg[k]) ? i : best, 0);
    return (
      <div className="field">
        <label>{label} <strong>{fmt(cfg[k])}</strong></label>
        <input type="range" min={0} max={values.length - 1} step={1} value={idx}
          onChange={e => set(k, values[+e.target.value])} />
      </div>
    );
  };

  const Toggle = ({ label, k }) => (
    <div className="toggle-row">
      <span>{label}</span>
      <label className="switch">
        <input type="checkbox" checked={!!cfg[k]} onChange={e => set(k, e.target.checked)} />
        <span className="switch-slider" />
      </label>
    </div>
  );

  return (
    <div className="page">
      <div className="page-hdr"><h2>Bot settings</h2></div>

      <div className="settings-grid">

        {/* API Keys */}
        <div className="card">
          <h3>Your Binance API keys (Live) {keyStatus.hasKeys && <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 400 }}>✓ saved</span>}</h3>
          {[
            { id: 'apiKey',    label: 'Binance API key' },
            { id: 'apiSecret', label: 'Binance secret key' },
          ].map(({ id, label }) => (
            <div key={id} className="field">
              <label>{label}</label>
              <div className="key-row">
                <input type={show[id] ? 'text' : 'password'} value={keys[id]}
                  onChange={e => setKeys(p => ({ ...p, [id]: e.target.value }))} placeholder="Paste here" />
                <button className="eye-btn" onClick={() => setShow(p => ({ ...p, [id]: !p[id] }))}>👁</button>
              </div>
            </div>
          ))}
          <button className="btn-save" style={{ marginTop: 6 }} onClick={saveKeys}>{keySaved || 'Save keys'}</button>
          <p style={{ fontSize: 11, color: '#8892a4', marginTop: 8 }}>
            🔒 Your keys are encrypted before being stored — only your bot uses them. This is your live Binance account — real funds, real trades.
          </p>
        </div>

        {/* Signal filter */}
        <div className="card">
          <h3>Signal filter</h3>
          <Slider label="Min probability" k="minProbability" min={0} max={100} fmt={v => v + '%'} />
          <div className="field">
            <label>Confidence mode</label>
            <select value={cfg.confidenceMode || 'balanced'} onChange={e => set('confidenceMode', e.target.value)}>
              <option value="conservative">Conservative (70%+)</option>
              <option value="balanced">Balanced (50%+)</option>
              <option value="aggressive">Aggressive (30%+)</option>
            </select>
          </div>
        </div>

        {/* Leverage */}
        <div className="card">
          <h3>Leverage & margin</h3>
          <Slider label="Leverage" k="leverage" min={1} max={125} fmt={v => v + 'x'} />
          <div className="lev-btns">
            {[1,5,10,20,50,125].map(l => (
              <button key={l} className={`lev-btn ${cfg.leverage === l ? 'active' : ''}`} onClick={() => set('leverage', l)}>{l}x</button>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Margin mode</label>
            <select value={cfg.marginMode} onChange={e => set('marginMode', e.target.value)}>
              <option value="CROSSED">Cross margin</option>
              <option value="ISOLATED">Isolated margin</option>
            </select>
          </div>
        </div>

        {/* TP / SL */}
        <div className="card">
          <h3>Take profit / Stop loss</h3>
          <Slider label="Take profit" k="takeProfitPct" min={0.5} max={20} step={0.5} fmt={v => v + '%'} />
          <Slider label="Stop loss"   k="stopLossPct"   min={0.5} max={10} step={0.5} fmt={v => v + '%'} />
          <div style={{ fontSize: 13, marginTop: 8 }}>
            Risk/reward: <strong className="green">1 : {(cfg.takeProfitPct / cfg.stopLossPct).toFixed(1)}</strong>
          </div>
        </div>

        {/* Trade limits */}
        <div className="card">
          <h3>Trade limits</h3>
          <Slider label="Max open trades"  k="maxOpenTrades"   min={1} max={20} />
          <Slider label="Max trades/day"   k="maxTradesPerDay" min={1} max={50} />
          <div className="field">
            <label>Scan interval</label>
            <select value={cfg.scanIntervalSeconds} onChange={e => set('scanIntervalSeconds', +e.target.value)}>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
            </select>
          </div>
        </div>

        {/* Trade amount */}
        <div className="card">
          <h3>Auto trade amount</h3>
          <div className="field">
            <label>Mode</label>
            <select value={cfg.tradeMode} onChange={e => set('tradeMode', e.target.value)}>
              <option value="fixed">Fixed USDT amount</option>
              <option value="pct">% of balance</option>
            </select>
          </div>
          {cfg.tradeMode === 'fixed' && <AmountSlider label="Amount per trade" k="tradeAmountUsd" values={AMOUNT_STEPS} fmt={v => '$' + v} />}
          {cfg.tradeMode === 'pct'   && <Slider label="% of balance"     k="tradeAmountPct" min={1}  max={50}   fmt={v => v + '%'} />}
        </div>

        {/* Risk management */}
        <div className="card">
          <h3>Risk management</h3>
          <Slider label="Daily loss limit" k="dailyLossLimitPct" min={1} max={30} fmt={v => v + '%'} />
          <Slider label="Max drawdown"     k="maxDrawdownPct"    min={5} max={50} fmt={v => v + '%'} />
          <Toggle label="Pause bot on daily limit" k="pauseOnDailyLimit" />
        </div>

        {/* Options */}
        <div className="card">
          <h3>Options</h3>
          <Toggle label="Allow long trades"                k="allowLong" />
          <Toggle label="Allow short trades"               k="allowShort" />
          <Toggle label="Trailing stop loss"               k="trailingStopLoss" />
          <Toggle label="Compound profits"                 k="compoundProfits" />
          <Toggle label="Auto reduce leverage on loss"     k="autoReduceLeverage" />
          <Toggle label="Claude AI analysis"                k="useAnthropicAnalysis" />
          <Toggle label="Claude blocks low-quality signals" k="anthropicBlocksLowQuality" />
        </div>

        {/* Pairs */}
        <div className="card full">
          <h3>
            Futures pairs
            <span style={{ fontWeight: 400, fontSize: 12, color: '#8892a4', marginLeft: 8 }}>
              {cfg.maxPairs === null
                ? `${cfg.pairs.length} selected — unlimited on your plan`
                : cfg.maxPairs === 0
                  ? 'No active plan — subscribe in Billing to select pairs'
                  : `${cfg.pairs.length} / ${cfg.maxPairs} selected`}
            </span>
          </h3>
          <div className="chip-row">
            {ALL_PAIRS.map(p => {
              const selected = cfg.pairs.includes(p);
              const atCap = cfg.maxPairs !== null && !selected && cfg.pairs.length >= cfg.maxPairs;
              return (
                <span
                  key={p}
                  className={`chip ${selected ? 'active' : ''}`}
                  style={atCap ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                  onClick={() => togglePair(p)}
                >
                  {p.replace('USDT', '/USDT')}
                </span>
              );
            })}
          </div>
        </div>

      </div>

      <div className="save-bar">
        <button className="btn-save" onClick={save}>{saved ? '✓ Saved!' : 'Save settings'}</button>
        <button className="btn-reset" onClick={reset}>Reset to defaults</button>
      </div>
    </div>
  );
}
