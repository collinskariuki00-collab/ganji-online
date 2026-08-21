import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    return fetch('/api/auth/me', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        setUser(d?.user || null);
        setSubscription(d?.subscription || null);
      })
      .catch(() => { setUser(null); setSubscription(null); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password, rememberMe = false) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Login failed');
    await refresh();
    return d;
  };

  const register = async (email, password) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Registration failed');
    await refresh();
    return d;
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setSubscription(null);
  };

  const verifyEmail = async (token) => {
    const r = await fetch('/api/auth/verify-email', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Verification failed');
    await refresh();
    return d;
  };

  const resendVerification = async (email) => {
    const r = await fetch('/api/auth/resend-verification', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not resend verification email');
    return d;
  };

  const forgotPassword = async (email) => {
    const r = await fetch('/api/auth/forgot-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not send reset email');
    return d;
  };

  const resetPassword = async (token, password) => {
    const r = await fetch('/api/auth/reset-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not reset password');
    return d;
  };

  return (
    <AuthContext.Provider value={{
      user, subscription, loading, login, register, logout, refresh,
      verifyEmail, resendVerification, forgotPassword, resetPassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
