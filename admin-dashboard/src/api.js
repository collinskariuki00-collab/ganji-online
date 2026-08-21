// In dev, package.json's "proxy" forwards relative /api/* calls to the
// backend, so API_BASE stays empty. In production this app is typically
// built as static files and served from its own origin (e.g.
// admin.yourdomain.com), separate from the backend — set
// REACT_APP_API_URL at build time so requests go to the real backend
// instead of the admin app's own (non-existent) /api routes.
const API_BASE = process.env.REACT_APP_API_URL || '';

export async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  return res;
}

// Convenience wrapper for the common case: JSON in, JSON out, throw with
// the server's error message on failure.
export async function apiJson(path, opts = {}) {
  const res = await apiFetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
