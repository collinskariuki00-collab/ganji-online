import React, { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (!token) { setError('Missing or invalid reset link'); return; }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
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
        <p className="auth-sub">Set a new password</p>
        {error && <div className="auth-error">{error}</div>}
        {done ? (
          <div className="auth-success">Password updated. Redirecting to log in...</div>
        ) : (
          <>
            <label>New password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoFocus />
            <label>Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} />
            <button type="submit" disabled={busy || !token}>{busy ? 'Updating...' : 'Update password'}</button>
          </>
        )}
        <p className="auth-switch"><Link to="/login">Back to log in</Link></p>
      </form>
    </div>
  );
}
