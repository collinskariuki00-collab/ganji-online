import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login          from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword  from './pages/ResetPassword';
import Dashboard       from './pages/Dashboard';
import { AuthProvider, useAuth } from './context/AuthContext';

function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">Huantam — Admin</span>
        </div>
        <div className="nav-right">
          <button className="nav-tab" title={user?.email} onClick={logout}>Log out ({user?.email})</button>
        </div>
      </nav>
      <main className="main">
        <Dashboard />
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
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<RequireAdmin><Shell /></RequireAdmin>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
