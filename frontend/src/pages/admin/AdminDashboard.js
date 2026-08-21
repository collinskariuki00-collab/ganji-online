import React, { useState, useEffect } from 'react';

const PLAN_LABEL = { monthly: 'Monthly', daily: 'Daily', trial: 'Trial' };

const EVENT_LABEL = {
  register: 'Registered', login: 'Logged in', email_verified: 'Verified email', password_reset: 'Reset password',
  trial_claimed: 'Claimed trial', payment_completed: 'Paid', bot_started: 'Started bot', bot_stopped: 'Stopped bot',
  admin_block_ip: 'Admin blocked IP', admin_unblock_ip: 'Admin unblocked IP',
  admin_disable_client: 'Admin disabled client', admin_enable_client: 'Admin enabled client',
  admin_create_client: 'Admin created account', admin_delete_client: 'Admin deleted account',
};

export default function AdminDashboard() {
  const [clients, setClients] = useState([]);
  const [revenue, setRevenue] = useState([]);
  const [activities, setActivities] = useState([]);
  const [blockedIps, setBlockedIps] = useState([]);
  const [newBlockIp, setNewBlockIp] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [config, setConfig] = useState({
    anthropic_api_key: '',
    monthly_price_kes: '', monthly_price_usdt: '',
    daily_price_kes: '', daily_price_usdt: '',
  });
  const [newKey, setNewKey] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const load = () => {
    fetch('/api/admin/clients', { credentials: 'include' }).then(r => r.json()).then(setClients).catch(() => {});
    fetch('/api/admin/revenue', { credentials: 'include' }).then(r => r.json()).then(setRevenue).catch(() => {});
    fetch('/api/admin/activities?limit=100', { credentials: 'include' }).then(r => r.json()).then(setActivities).catch(() => {});
    fetch('/api/admin/blocked-ips', { credentials: 'include' }).then(r => r.json()).then(setBlockedIps).catch(() => {});
    fetch('/api/admin/config', { credentials: 'include' }).then(r => r.json()).then(setConfig).catch(() => {});
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  const toggleClient = (id, enable) => {
    fetch(`/api/admin/clients/${id}/${enable ? 'enable' : 'disable'}`, { method: 'POST', credentials: 'include' })
      .then(load);
  };

  const deleteClient = (c) => {
    if (!window.confirm(`Permanently delete ${c.email}? This cannot be undone.`)) return;
    fetch(`/api/admin/clients/${c.id}`, { method: 'DELETE', credentials: 'include' }).then(load);
  };

  const blockIp = async () => {
    if (!newBlockIp.trim()) return;
    await fetch('/api/admin/blocked-ips', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: newBlockIp.trim(), reason: newBlockReason.trim() || undefined }),
    });
    setNewBlockIp(''); setNewBlockReason('');
    load();
  };

  const unblockIp = async (ip) => {
    await fetch(`/api/admin/blocked-ips/${encodeURIComponent(ip)}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  const priceKeys = ['monthly_price_kes', 'monthly_price_usdt', 'daily_price_kes', 'daily_price_usdt'];

  const saveConfig = async () => {
    const body = {};
    if (newKey) body.anthropic_api_key = newKey;
    for (const k of priceKeys) body[k] = config[k];
    await fetch('/api/admin/config', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setNewKey('');
    setSavedMsg('Saved.');
    setTimeout(() => setSavedMsg(''), 2000);
    load();
  };

  const totalRevenue = revenue.reduce((acc, r) => {
    acc[r.currency] = (acc[r.currency] || 0) + Number(r.total);
    return acc;
  }, {});

  return (
    <div className="admin-page">
      <h1>⚡ Huantam — Admin</h1>

      <section className="admin-section">
        <h2>Revenue</h2>
        <div className="admin-cards">
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
            <div className="admin-card-value">{clients.filter(c => c.bot_status === 'active').length}</div>
            <div className="admin-card-label">Active subscriptions</div>
          </div>
          <div className="admin-card">
            <div className="admin-card-value">{clients.filter(c => c.bot?.running).length}</div>
            <div className="admin-card-label">Bots currently running</div>
          </div>
          <div className="admin-card">
            <div className="admin-card-value">{clients.filter(c => c.trial_claimed_at).length}</div>
            <div className="admin-card-label">Trials claimed</div>
          </div>
        </div>
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

      <section className="admin-section">
        <h2>Recent activity</h2>
        <table className="admin-table">
          <thead>
            <tr><th>When</th><th>User</th><th>Event</th><th>IP</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {activities.length === 0 && (
              <tr><td colSpan={5} style={{ color: '#8892a4' }}>No activity yet</td></tr>
            )}
            {activities.map(a => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</td>
                <td>{a.user_email || '—'}</td>
                <td>{EVENT_LABEL[a.event_type] || a.event_type}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{a.ip_address || '—'}</td>
                <td style={{ fontSize: 11, color: '#8892a4', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.detail ? JSON.stringify(a.detail) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Blocked IPs</h2>
        <p style={{ fontSize: 12, color: '#8892a4', marginBottom: 10 }}>
          Manual tool for actual abuse — blocking an IP here rejects every API request from it (not just trial claims).
          Note many mobile users in Kenya share carrier-NAT IPs, so this can occasionally affect more than one person.
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
              <tr><td colSpan={5} style={{ color: '#8892a4' }}>No IPs blocked</td></tr>
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
          {savedMsg && <span style={{ marginLeft: 10, color: '#4ade80' }}>{savedMsg}</span>}
        </div>
      </section>
    </div>
  );
}
