import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Dashboard  from './pages/Dashboard';
import Signals    from './pages/Signals';
import Trades     from './pages/Trades';
import Settings   from './pages/Settings';
import Logs       from './pages/Logs';
import Login      from './pages/Login';
import Register   from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword  from './pages/ResetPassword';
import Billing    from './pages/Billing';
import AdminDashboard from './pages/admin/AdminDashboard';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useWebSocket } from './hooks/useWebSocket';

const TABS = ['Dashboard', 'Signals', 'Trades', 'Logs', 'Settings'];

function RequireAuth({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/app" replace />;
  return children;
}

function TradingApp() {
  const { user, subscription, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab]     = useState('Dashboard');
  const [botOn, setBotOn] = useState(false);
  const [keysStatus, setKeysStatus] = useState(null); // { mode: 'live', hasKeys }

  // Session token is embedded (via a lightweight endpoint) so the WS
  // handshake can identify the user — cookies aren't reliably sent on WS
  // handshakes across all browsers/proxies.
  const [wsToken, setWsToken] = useState(null);
  useEffect(() => {
    fetch('/api/auth/ws-token', { credentials: 'include' })
      .then(r => r.json()).then(d => setWsToken(d.token)).catch(() => {});
  }, []);

  const { prices, positions, signals, anthropicAnalysis, resting, balance, lastMessage, logs } =
    useWebSocket(wsToken ? `ws://${window.location.hostname}:4000?token=${wsToken}` : null);

  const isActive = subscription?.botActive;

  useEffect(() => {
    fetch('/api/bot/status', { credentials: 'include' }).then(r => r.json()).then(d => setBotOn(d.running)).catch(() => {});
    fetch('/api/bot/account-mode', { credentials: 'include' }).then(r => r.json()).then(setKeysStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (lastMessage?.type === 'bot_status') setBotOn(lastMessage.running);
  }, [lastMessage]);

  const toggleBot = () => {
    if (!botOn && !isActive) { navigate('/billing'); return; }
    if (!botOn && !keysStatus?.hasKeys) { alert('Add your Binance API key in Settings before starting the bot.'); return; }
    const ep = botOn ? '/api/bot/stop' : '/api/bot/start';
    fetch(ep, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.error) alert(d.error); else setBotOn(d.running); })
      .catch(() => {});
  };

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">Huantam</span>
          <span className="tag binance">Binance</span>
          <span className="tag futures">Futures</span>
        </div>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button key={t} className={`nav-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className="nav-right">
          {!isActive && (
            <button className="account-btn" style={{ color: '#facc15', borderColor: '#facc1566' }} onClick={() => navigate('/billing')}>
              Subscribe to trade
            </button>
          )}
          {keysStatus && (
            <div className="account-btn live" title={keysStatus.hasKeys ? '' : 'No Binance API key on file — add it in Settings'}>
              <span className="dot" /> LIVE account
              {!keysStatus.hasKeys && <span className="warn-badge">no keys</span>}
            </div>
          )}
          <div className={`status-pill ${botOn ? 'on' : 'off'}`}>
            <span className="dot" /> {botOn ? 'Running' : 'Stopped'}
          </div>
          {botOn && resting?.resting && (
            <div className="status-pill resting" title="Trade slots full — Claude calls paused until a trade closes">
              <span className="dot" /> Resting ({resting.openTrades}/{resting.maxOpenTrades})
            </div>
          )}
          <button className={`bot-btn ${botOn ? 'stop' : 'start'}`} onClick={toggleBot}>
            {botOn ? 'Stop bot' : 'Start bot'}
          </button>
          <button className="nav-tab" title={user?.email} onClick={logout}>Log out</button>
        </div>
      </nav>
      <main className="main">
        {tab === 'Dashboard' && <Dashboard prices={prices} positions={positions} signals={signals} anthropicAnalysis={anthropicAnalysis} balance={balance} />}
        {tab === 'Signals'   && <Signals signals={signals} />}
        {tab === 'Trades'    && <Trades prices={prices} />}
        {tab === 'Logs'      && <Logs liveLogs={logs} />}
        {tab === 'Settings'  && <Settings />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth adminOnly><AdminDashboard /></RequireAuth>} />
          <Route path="/app" element={<RequireAuth><TradingApp /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
