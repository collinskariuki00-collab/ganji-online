import React, { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import { ZapIcon, LockIcon, EyeIcon, EyeOffIcon } from '../components/icons';

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
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
    <AuthLayout>
      <div className="auth-card-v2">
        <div className="auth-card-icon"><ZapIcon /></div>
        <h2>Set a new password</h2>
        <p className="auth-card-sub">Choose something you haven't used before</p>

        {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}

        {done ? (
          <div className="auth-success">Password updated. Redirecting to log in...</div>
        ) : (
          <form onSubmit={submit}>
            <label>New password</label>
            <div className="input-icon-wrap">
              <LockIcon className="input-icon" />
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoFocus />
              <button type="button" className="input-icon-toggle" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            <label>Confirm new password</label>
            <div className="input-icon-wrap">
              <LockIcon className="input-icon" />
              <input type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} />
            </div>
            <button type="submit" className="auth-submit-btn" disabled={busy || !token}>{busy ? 'Updating...' : 'Update password'}</button>
          </form>
        )}

        <p className="auth-switch-v2"><Link to="/login">Back to log in</Link></p>
      </div>
    </AuthLayout>
  );
}
