// Resolves the real client IP regardless of Express's `trust proxy` setting
// (which we deliberately leave off elsewhere to avoid the rate-limiter
// X-Forwarded-For warning). Prefers the leftmost X-Forwarded-For entry —
// the original client, even through ngrok or a future reverse proxy —
// falling back to the raw socket address for direct connections.
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

module.exports = { getClientIp };
