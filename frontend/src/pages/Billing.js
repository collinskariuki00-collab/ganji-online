import React, { useState, useEffect } from 'react';
import { getDeviceId } from '../utils/deviceId';
import { useAuth } from '../context/AuthContext';

const PLAN_TITLE = { monthly: 'Monthly', daily: 'Daily' };
const PLAN_DESC = {
  monthly: 'Full automated bot, all pairs, billed every 30 days.',
  daily:   'Full automated bot, all pairs, for 24 hours — try it before committing monthly.',
};

export default function Billing() {
  const { refresh } = useAuth();
  const [plan, setPlan]     = useState('monthly');
  const [method, setMethod] = useState('mpesa');
  const [phone, setPhone]   = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy]     = useState(false);
  const [sub, setSub]       = useState(null);
  const [prices, setPrices] = useState(null);
  const [trial, setTrial]   = useState(null); // { claimed, hours }
  const [trialBusy, setTrialBusy] = useState(false);

  const refreshStatus = () => {
    fetch('/api/payments/status', { credentials: 'include' }).then(r => r.json()).then(setSub).catch(() => {});
  };

  useEffect(() => {
    refreshStatus();
    fetch('/api/payments/prices', { credentials: 'include' }).then(r => r.json()).then(setPrices).catch(() => {});
    fetch('/api/trial/status', { credentials: 'include' }).then(r => r.json()).then(setTrial).catch(() => {});
  }, []);

  const claimTrial = async () => {
    setTrialBusy(true); setStatus('');
    try {
      const r = await fetch('/api/trial/claim', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getDeviceId() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setTrial({ claimed: true, hours: d.hours });
      await refreshStatus();
      await refresh(); // updates subscription state app-wide
      setStatus(`Trial activated! Full access for ${d.hours} hours.`);
    } catch (err) {
      setStatus('Error: ' + err.message);
    } finally {
      setTrialBusy(false);
    }
  };

  const pay = async (path, body) => {
    setBusy(true); setStatus('');
    try {
      const r = await fetch(path, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.url) { window.location.href = d.url; return; }
      if (d.invoiceUrl) { window.location.href = d.invoiceUrl; return; }
      setStatus('Check your phone and enter your M-Pesa PIN. This page will update once payment is confirmed.');
      const iv = setInterval(refreshStatus, 4000);
      setTimeout(() => clearInterval(iv), 120000);
    } catch (err) {
      setStatus('Error: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const isActive = sub?.botActive;
  const currentPlan = sub?.bot?.status === 'active' ? sub.bot.plan : null;
  const info = prices?.[plan];

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 440 }}>
        <h1>⚡ Subscription</h1>
        <p className="auth-sub">Full access, either way — pick your billing cycle</p>

        {!trial?.claimed && !sub?.botActive && (
          <div style={{
            background: '#14301e', border: '1px solid #22c55e55', borderRadius: 8,
            padding: '10px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <div style={{ fontSize: 12, color: '#bbf7d0' }}>
              🎁 New here? Try full access <strong>free for 24 hours</strong> — no payment needed.
            </div>
            <button
              disabled={trialBusy}
              onClick={claimTrial}
              style={{ background: '#22c55e', color: '#052e16', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {trialBusy ? 'Activating...' : 'Start free trial'}
            </button>
          </div>
        )}
        {trial?.claimed && !sub?.botActive && (
          <div style={{ fontSize: 12, color: '#8892a4', marginBottom: 12 }}>
            You've already used your free trial. Pick a plan below to continue.
          </div>
        )}

        <div className="pay-tabs">
          {['monthly', 'daily'].map(p => (
            <button key={p} className={`pay-tab ${plan === p ? 'active' : ''}`} onClick={() => setPlan(p)}>
              {PLAN_TITLE[p]} {currentPlan === p && '✓'}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: '#8892a4', marginBottom: 8 }}>
          {PLAN_DESC[plan]}
          {info && (
            <div style={{ marginTop: 6, color: '#e2e8f0' }}>
              KES {info.kes} &nbsp;or&nbsp; {info.usdt} USDT {plan === 'monthly' ? '/ month' : '/ 24h'}
            </div>
          )}
          {isActive && currentPlan === plan && <div style={{ marginTop: 4, color: '#4ade80' }}>Currently active</div>}
        </div>

        <div className="pay-tabs" style={{ marginTop: 6 }}>
          {['mpesa', 'card', 'crypto'].map(m => (
            <button key={m} className={`pay-tab ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>
              {m === 'mpesa' ? 'M-Pesa' : m === 'card' ? 'Card' : 'USDT'}
            </button>
          ))}
        </div>

        {method === 'mpesa' && (
          <>
            <label>Phone (2547XXXXXXXX)</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="254712345678" />
            <button disabled={busy} onClick={() => pay('/api/payments/mpesa/initiate', { phone, plan })}>
              {busy ? 'Sending STK push...' : `Pay ${PLAN_TITLE[plan]} with M-Pesa`}
            </button>
          </>
        )}
        {method === 'card' && (
          <button disabled={busy} onClick={() => pay('/api/payments/card/initiate', { plan })}>
            {busy ? 'Redirecting...' : `Pay ${PLAN_TITLE[plan]} with Card`}
          </button>
        )}
        {method === 'crypto' && (
          <button disabled={busy} onClick={() => pay('/api/payments/crypto/initiate', { plan })}>
            {busy ? 'Redirecting...' : `Pay ${PLAN_TITLE[plan]} with USDT`}
          </button>
        )}

        {status && <p className="auth-error" style={{ background: 'transparent', color: '#facc15' }}>{status}</p>}
      </div>
    </div>
  );
}
