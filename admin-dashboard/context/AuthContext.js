import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch, apiJson } from '../api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const d = await res.json();
        setUser(d.user?.role === 'admin' ? d.user : null); // this app is admin-only, regardless of who's logged in via cookie
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const login = async (email, password) => {
    const d = await apiJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (d.user.role !== 'admin') {
      // Valid credentials, but not an admin account — this app has no use
      // for a client session, so drop it immediately rather than leave a
      // dangling cookie for an account this UI can't do anything with.
      await apiFetch('/api/auth/logout', { method: 'POST' });
      throw new Error('This account does not have admin access.');
    }
    setUser(d.user);
    return d;
  };

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const forgotPassword = (email) => apiJson('/api/auth/forgot-password', {
    method: 'POST', body: JSON.stringify({ email }),
  });

  const resetPassword = (token, password) => apiJson('/api/auth/reset-password', {
    method: 'POST', body: JSON.stringify({ token, password }),
  });

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, forgotPassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}
