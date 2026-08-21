import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiJson } from '../api';

const PLAN_LABEL = { monthly: 'Monthly', daily: 'Daily', trial: 'Trial' };

const EVENT_LABEL = {
  register: 'Registered', login: 'Logged in', email_verified: 'Verified email', password_reset: 'Reset password',
  trial_claimed: 'Claimed trial', payment_completed: 'Paid', bot_started: 'Started bot', bot_stopped: 'Stopped bot',
  admin_block_ip: 'Admin blocked IP', admin_unblock_ip: 'Admin unblocked IP',
  admin_disable_client: 'Admin disabled client', admin_enable_client: 'Admin enabled client',
  admin_create_client: 'Admin created account', admin_delete_client: 'Admin deleted account',
};

const TABS = ['Clients', 'Live bots', 'Activity', 'Blocked IPs', 'Config', 'Logs'];

export default function Dashboard() {
  const [tab, setTab] = useState('Clients');
  const [clients, setClients] = useState([]);
  const [revenue, setRevenue] = useState([]);
  const [activities, setActivities] = useState([]);
  const [blockedIps, setBlockedIps] = useState([]);
  const [liveBots, setLiveBots] = useState([]);
  const [logs, setLogs] = useState([]);
  const [config, setConfig] = useState({
    anthropic_api_key: '',
    monthly_price_kes: '', monthly_price_usdt: '',
    daily_price_kes: '', daily_price_usdt: '',
  });

  const [newBlockIp, setNewBlockIp] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [newKey, setNewKey] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPassword, setNewClientPassword] = useState('');
  const [newClientRole, setNewClientRole] = useState('client');
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch('/api/admin/clients').then(r => r.json()).then(setClients).catch(() => {});
    apiFetch('/api/admin/revenue').then(r => r.json()).then(setRevenue).catch(() => {});
    apiFetch('/api/admin/activities?limit=100').then(r => r.json()).then(setActivities).catch(() => {});
    apiFetch('/api/admin/blocked-ips').then(r => r.json()).then(setBlockedIps).catch(() => {});
    apiFetch('/api/admin/config').then(r => r.json()).then(setConfig).catch(() => {});
  }, []);

  const loadLiveBots = useCallback(() => {
    apiFetch('/api/admin/bots/live').then(r => r.json()).then(setLiveBots).catch(() => {});
  }, []);

  const loadLogs = useCallback(() => {
    apiFetch('/api/admin/logs?limit=200').then(r => r.json()).then(setLogs).catch(() => {});
  }, []);

  // Clients/activity/etc refresh every 15s regardless of tab (cheap, and
  // keeps the Clients tab's "bots running" summary current). Live bot
  // positions refresh faster (5s) and only while that tab is open, since
  // each tick makes a real Binance call per client.
  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    if (tab !== 'Live bots') return;
    loadLiveBots();
    const iv = setInterval(loadLiveBots, 5000);
    return () => clearInterval(iv);
  }, [tab, loadLiveBots]);

  useEffect(() => {
    if (tab !== 'Logs') return;
    loadLogs();
    const iv = setInterval(loadLogs, 5000);
    return () => clearInterval(iv);
  }, [tab, loadLogs]);

  const toggleClient = (id, enable) => {
    apiFetch(`/api/admin/clients/${id}/${enable ? 'enable' : 'disable'}`, { method: 'POST' }).then(load);
  };

  const deleteClient = (c) => {
    if (!window.confirm(`Permanently delete ${c.email}? This cannot be undone — their subscriptions, saved keys, and payment history all go with it.`)) return;
    apiFetch(`/api/admin/clients/${c.id}`, { method: 'DELETE' }).then(load);
  };

  const createClient = async (e) => {
    e.preventDefault();
    setCreateError(''); setCreateBusy(true);
    try {
      await apiJson('/api/admin/clients', {
        method: 'POST',
        body: JSON.stringify({ email: newClientEmail, password: newClientPassword, role: newClientRole }),
      });
      setNewClientEmail(''); setNewClientPassword(''); setNewClientRole('client');
      load();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateBusy(false);
    }
  };

  const blockIp = async () => {
    if (!newBlockIp.trim()) return;
    await apiFetch('/api/admin/blocked-ips', {
      method: 'POST',
      body: JSON.stringify({ ip: newBlockIp.trim(), reason: newBlockReason.trim() || undefined }),
    });
    setNewBlockIp(''); setNewBlockReason('');
    load();
  };

  const unblockIp = async (ip) => {
    await apiFetch(`/api/admin/blocked-ips/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    load();
  };

  const priceKeys = ['monthly_price_kes', 'monthly_price_usdt', 'daily_price_kes', 'daily_price_usdt'];

  const saveConfig = async () => {
    const body = {};
    if (newKey) body.anthropic_api_key = newKey;
    for (const k of priceKeys) body[k] = config[k];
    await apiFetch('/api/admin/config', { method: 'PATCH', body: JSON.stringify(body) });
    setNewKey('');
    setSavedMsg('Saved.');
    setTimeout(() => setSavedMsg(''), 2000);
    load();
  };

  const totalRevenue = revenue.reduce((acc, r) => {
    acc[r.currency] = (acc[r.currency] || 0) + Number(r.total);
    return acc;
  }, {});

  const totalOpenPositions = liveBots.reduce((sum, b) => sum + (b.positions?.length || 0), 0);
  const totalUnrealizedPnl = liveBots.reduce(
    (sum, b) => sum + (b.positions || []).reduce((s, p) => s + (p.unrealizedPnl || 0), 0), 0
  );

  return (
    <div className="admin-page">
      <div className="admin-cards" style={{ marginBottom: '1.5rem' }}>
        {Object.entries(totalRevenue).length === 0 && <div className="admin-card">No completed payments yet</div>}
        {Object.entries(totalRevenue).map(([currency, total]) => (
          <div key={currency} className="admin-card">
            <div className="admin-card-value">{total.toLocaleString()} {currency}</div>
            <div className="admin-card-label">Total collected</div>
          </div>
        ))}
        <div className="admin-card">
          <div className="admin-card-value">{clients.length}</div>
          <div className="admin-card-label">Total clients</div>
        </div>
        <div className="admin-card">
          <div className="admin-card-value">{clients.filter(c => c.bot?.running).length}</div>
          <div className="admin-card-label">Bots currently running</div>
        </div>
      </div>

      <div className="nav-tabs" style={{ marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button key={t} className={`nav-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Clients' && (
        <>
          <section className="admin-section">
            <h2>Add a client</h2>
            <form className="admin-config" onSubmit={createClient} style={{ maxWidth: 480 }}>
              {createError && <div className="auth-error">{createError}</div>}
              <label>Email</label>
              <input type="email" value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} required />
              <label>Temporary password</label>
              <input type="text" value={newClientPassword} onChange={e => setNewClientPassword(e.target.value)} required minLength={8} placeholder="min 8 characters" />
              <label>Role</label>
              <select value={newClientRole} onChange={e => setNewClientRole(e.target.value)}
                style={{ background: 'var(--bg3)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '8px 10px', color: 'var(--txt)', fontSize: 13 }}>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" disabled={createBusy}>{createBusy ? 'Creating...' : 'Create account'}</button>
              <span style={{ fontSize: 11, color: 'var(--txt2)' }}>Created accounts skip email verification — share the password with them directly.</span>
            </form>
          </section>

          <section className="admin-section">
            <h2>Clients</h2>
            <table className="admin-table">
              <thead>
                <tr><th>Email</th><th>Plan</th><th>Expires</th><th>Bot</th><th>Trial</th><th>Last login</th><th>Last IP</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id}>
                    <td>
                      {c.email}
                      {!c.email_verified && (
                        <span className="warn-badge" title="Hasn't clicked their verification email yet" style={{ marginLeft: 6 }}>unverified</span>
                      )}
                    </td>
                    <td>{c.bot_status === 'active' ? (PLAN_LABEL[c.bot_plan] || c.bot_plan) : '—'}</td>
                    <td>{c.bot_status === 'active' ? new Date(c.bot_expires_at).toLocaleDateString() : '—'}</td>
                    <td>{c.bot ? (c.bot.running ? `Running (${c.bot.openTrades} open)` : 'Stopped') : 'Not loaded'}</td>
                    <td>{c.trial_claimed_at ? new Date(c.trial_claimed_at).toLocaleDateString() : '—'}</td>
                    <td>{c.last_login_at ? new Date(c.last_login_at).toLocaleString() : '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.last_login_ip || '—'}</td>
                    <td>{c.is_active ? 'Active' : 'Disabled'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {c.is_active
                        ? <button className="admin-btn danger" onClick={() => toggleClient(c.id, false)}>Disable</button>
                        : <button className="admin-btn" onClick={() => toggleClient(c.id, true)}>Enable</button>}
                      <button className="admin-btn danger" onClick={() => deleteClient(c)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'Live bots' && (
        <section className="admin-section">
          <h2>Live bots</h2>
          <p style={{ fontSize: 12, color: 'var(--txt2)', marginBottom: 10 }}>
            Real Binance positions for every client whose bot is currently loaded in memory — a client who
            hasn't opened their dashboard or started their bot since the last server restart won't show up
            until they do. Refreshes every 5s.
          </p>
          <div className="admin-cards" style={{ marginBottom: '1rem' }}>
            <div className="admin-card">
              <div className="admin-card-value">{liveBots.filter(b => b.running).length}</div>
              <div className="admin-card-label">Bots running</div>
            </div>
            <div className="admin-card">
              <div className="admin-card-value">{totalOpenPositions}</div>
              <div className="admin-card-label">Open positions</div>
            </div>
            <div className="admin-card">
              <div className={`admin-card-value ${totalUnrealizedPnl >= 0 ? 'green' : 'red'}`}>
                {totalUnrealizedPnl >= 0 ? '+' : ''}{totalUnrealizedPnl.toFixed(2)}
              </div>
              <div className="admin-card-label">Total unrealized PnL (USDT)</div>
            </div>
          </div>
          <table className="admin-table">
            <thead>
              <tr><th>Client</th><th>Mode</th><th>Status</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Mark</th><th>PnL</th><th>Leverage</th></tr>
            </thead>
            <tbody>
              {liveBots.length === 0 && (
                <tr><td colSpan={10} style={{ color: 'var(--txt2)' }}>No bots currently loaded in memory</td></tr>
              )}
              {liveBots.map(b => (
                b.error ? (
                  <tr key={b.userId}>
                    <td>{b.email || `#${b.userId}`}</td>
                    <td>{b.mode}</td>
                    <td className="red">Error: {b.error}</td>
                    <td colSpan={7}>—</td>
                  </tr>
                ) : b.positions.length === 0 ? (
                  <tr key={b.userId}>
                    <td>{b.email || `#${b.userId}`}</td>
                    <td>{b.mode}</td>
                    <td>{b.running ? 'Running' : 'Stopped'}</td>
                    <td colSpan={7} style={{ color: 'var(--txt2)' }}>No open positions</td>
                  </tr>
                ) : b.positions.map((p, i) => (
                  <tr key={`${b.userId}-${p.symbol}`}>
                    {i === 0 && <td rowSpan={b.positions.length}>{b.email || `#${b.userId}`}</td>}
                    {i === 0 && <td rowSpan={b.positions.length}>{b.mode}</td>}
                    {i === 0 && <td rowSpan={b.positions.length}>{b.running ? 'Running' : 'Stopped'}</td>}
                    <td>{p.symbol}</td>
                    <td className={p.side === 'LONG' ? 'green' : 'red'}>{p.side}</td>
                    <td>{p.quantity}</td>
                    <td>{p.entryPrice}</td>
                    <td>{p.markPrice}</td>
                    <td className={p.unrealizedPnl >= 0 ? 'green' : 'red'}>{p.unrealizedPnl >= 0 ? '+' : ''}{p.unrealizedPnl.toFixed(2)}</td>
                    <td>{p.leverage}x</td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'Activity' && (
        <section className="admin-section">
          <h2>Recent activity</h2>
          <table className="admin-table">
            <thead>
              <tr><th>When</th><th>User</th><th>Event</th><th>IP</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {activities.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--txt2)' }}>No activity yet</td></tr>
              )}
              {activities.map(a => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</td>
                  <td>{a.user_email || '—'}</td>
                  <td>{EVENT_LABEL[a.event_type] || a.event_type}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{a.ip_address || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--txt2)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.detail ? JSON.stringify(a.detail) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'Blocked IPs' && (
        <section className="admin-section">
          <h2>Blocked IPs</h2>
          <p style={{ fontSize: 12, color: 'var(--txt2)', marginBottom: 10 }}>
            Manual tool for actual abuse — blocking an IP here rejects every API request from it (not just trial claims).
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input placeholder="IP address" value={newBlockIp} onChange={e => setNewBlockIp(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '8px 10px', color: 'var(--txt)', fontSize: 13, width: 160 }} />
            <input placeholder="Reason (optional)" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '8px 10px', color: 'var(--txt)', fontSize: 13, flex: 1, minWidth: 160 }} />
            <button className="admin-btn danger" onClick={blockIp}>Block IP</button>
          </div>
          <table className="admin-table">
            <thead>
              <tr><th>IP</th><th>Reason</th><th>Blocked by</th><th>When</th><th></th></tr>
            </thead>
            <tbody>
              {blockedIps.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--txt2)' }}>No IPs blocked</td></tr>
              )}
              {blockedIps.map(b => (
                <tr key={b.ip_address}>
                  <td style={{ fontFamily: 'monospace' }}>{b.ip_address}</td>
                  <td>{b.reason || '—'}</td>
                  <td>{b.blocked_by}</td>
                  <td>{new Date(b.blocked_at).toLocaleString()}</td>
                  <td><button className="admin-btn" onClick={() => unblockIp(b.ip_address)}>Unblock</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'Config' && (
        <section className="admin-section">
          <h2>Global config</h2>
          <div className="admin-config">
            <label>Shared Anthropic (Claude) API key</label>
            <div className="admin-config-row">
              <span className="admin-config-current">{config.anthropic_api_key || 'not set'}</span>
              <input placeholder="sk-ant-..." value={newKey} onChange={e => setNewKey(e.target.value)} />
            </div>

            <label>Monthly — KES / 30 days</label>
            <input value={config.monthly_price_kes || ''} onChange={e => setConfig({ ...config, monthly_price_kes: e.target.value })} />
            <label>Monthly — USDT / 30 days</label>
            <input value={config.monthly_price_usdt || ''} onChange={e => setConfig({ ...config, monthly_price_usdt: e.target.value })} />

            <label>Daily — KES / 24h</label>
            <input value={config.daily_price_kes || ''} onChange={e => setConfig({ ...config, daily_price_kes: e.target.value })} />
            <label>Daily — USDT / 24h</label>
            <input value={config.daily_price_usdt || ''} onChange={e => setConfig({ ...config, daily_price_usdt: e.target.value })} />

            <button onClick={saveConfig}>Save config</button>
            {savedMsg && <span style={{ marginLeft: 10, color: 'var(--green)' }}>{savedMsg}</span>}
          </div>
        </section>
      )}

      {tab === 'Logs' && (
        <section className="admin-section">
          <h2>Server logs</h2>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 10, padding: 14, fontFamily: 'monospace', fontSize: 12, maxHeight: 600, overflowY: 'auto' }}>
            {logs.length === 0 && <div style={{ color: 'var(--txt2)' }}>No logs yet</div>}
            {logs.map((l, i) => (
              <div key={i} style={{ color: l.level === 'ERROR' ? 'var(--red)' : l.level === 'WARN' ? 'var(--acc)' : 'var(--txt2)', marginBottom: 3 }}>
                {`[${l.time || ''}] [${l.level || 'INFO'}] ${l.message || ''}`}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
