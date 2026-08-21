import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>⚡ Huantam</h1>
        <p className="auth-sub">Reset admin password</p>
        {error && <div className="auth-error">{error}</div>}
        {sent ? (
          <div className="auth-success">If that email is registered, a reset link is on its way.</div>
        ) : (
          <>
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            <button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
          </>
        )}
        <p className="auth-switch"><Link to="/login">Back to log in</Link></p>
      </form>
    </div>
  );
}
