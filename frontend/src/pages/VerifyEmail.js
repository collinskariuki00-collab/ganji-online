import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import { ZapIcon } from '../components/icons';

export default function VerifyEmail() {
  const { verifyEmail } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'error'
  const [error, setError] = useState('');
  const ran = useRef(false); // StrictMode/effect re-run guard — the token is single-use

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setError('Missing verification token.');
      return;
    }
    verifyEmail(token)
      .then((d) => {
        setStatus('success');
        setTimeout(() => navigate(d.user?.role === 'admin' ? '/admin' : '/app'), 1500);
      })
      .catch((err) => {
        setStatus('error');
        setError(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthLayout>
      <div className="auth-card-v2">
        <div className="auth-card-icon"><ZapIcon /></div>
        <h2>Verify your email</h2>
        {status === 'verifying' && <p className="auth-card-sub">Hang tight, confirming your account...</p>}

        {status === 'success' && (
          <div className="auth-success">Email verified! Taking you to your dashboard...</div>
        )}
        {status === 'error' && (
          <>
            <div className="auth-error">{error}</div>
            <p className="auth-switch-v2"><Link to="/login">Back to log in</Link></p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
