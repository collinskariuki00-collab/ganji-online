import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import { ZapIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon } from '../components/icons';

export default function Login() {
  const { login, resendVerification } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setResendMsg(''); setNeedsVerification(false); setBusy(true);
    try {
      const { user } = await login(email, password, remember);
      navigate(user.role === 'admin' ? '/admin' : '/app');
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes('verify your email')) setNeedsVerification(true);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setResendBusy(true); setResendMsg('');
    try {
      await resendVerification(email);
      setResendMsg('Verification email sent — check your inbox.');
    } catch (err) {
      setResendMsg(err.message);
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card-v2">
        <div className="auth-card-icon"><ZapIcon /></div>
        <h2>Welcome back</h2>
        <p className="auth-card-sub">Log in to your trading dashboard</p>

        {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}
        {needsVerification && (
          <button type="button" className="auth-link-btn" onClick={handleResend} disabled={resendBusy} style={{ marginBottom: 10 }}>
            {resendBusy ? 'Sending...' : 'Resend verification email'}
          </button>
        )}
        {resendMsg && <div className="auth-success" style={{ marginBottom: 10 }}>{resendMsg}</div>}

        <form onSubmit={submit}>
          <label>Email</label>
          <div className="input-icon-wrap">
            <MailIcon className="input-icon" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>

          <label>Password</label>
          <div className="input-icon-wrap">
            <LockIcon className="input-icon" />
            <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required />
            <button type="button" className="input-icon-toggle" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          <div className="auth-options-row">
            <label className="remember-me">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              Remember me
            </label>
            <Link to="/forgot-password" className="auth-forgot-link">Forgot password?</Link>
          </div>

          <button type="submit" className="auth-submit-btn" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
        </form>

        <p className="auth-switch-v2">No account? <Link to="/register">Sign up</Link></p>
      </div>
    </AuthLayout>
  );
}
