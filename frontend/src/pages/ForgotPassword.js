import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import { ZapIcon, MailIcon } from '../components/icons';

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true); // same response whether or not the account exists
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card-v2">
        <div className="auth-card-icon"><ZapIcon /></div>
        <h2>Reset your password</h2>
        <p className="auth-card-sub">We'll email you a reset link</p>

        {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}

        {sent ? (
          <div className="auth-success">If that email is registered, a reset link is on its way. Check your inbox.</div>
        ) : (
          <form onSubmit={submit}>
            <label>Email</label>
            <div className="input-icon-wrap">
              <MailIcon className="input-icon" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <button type="submit" className="auth-submit-btn" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
          </form>
        )}

        <p className="auth-switch-v2"><Link to="/login">Back to log in</Link></p>
      </div>
    </AuthLayout>
  );
}
