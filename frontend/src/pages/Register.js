import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import { ZapIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon } from '../components/icons';

export default function Register() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await register(email, password);
      // No session is issued on register anymore — the account stays
      // unverified until the email link is clicked, so land on a
      // "check your inbox" state instead of the app.
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthLayout>
        <div className="auth-card-v2">
          <div className="auth-card-icon"><ZapIcon /></div>
          <h2>Check your email</h2>
          <p className="auth-card-sub">You're almost there</p>
          <div className="auth-success">
            We sent a verification link to <strong>{email}</strong>. Click it to activate your account, then log in.
          </div>
          <p className="auth-switch-v2"><Link to="/login">Back to log in</Link></p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="auth-card-v2">
        <div className="auth-card-icon"><ZapIcon /></div>
        <h2>Create your account</h2>
        <p className="auth-card-sub">Start trading smarter with Huantam</p>

        {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}

        <form onSubmit={submit}>
          <label>Email</label>
          <div className="input-icon-wrap">
            <MailIcon className="input-icon" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>

          <label>Password</label>
          <div className="input-icon-wrap">
            <LockIcon className="input-icon" />
            <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
            <button type="button" className="input-icon-toggle" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          <button type="submit" className="auth-submit-btn" disabled={busy}>{busy ? 'Creating account...' : 'Sign up'}</button>
        </form>

        <p className="auth-switch-v2">Already have an account? <Link to="/login">Log in</Link></p>
      </div>
    </AuthLayout>
  );
}
