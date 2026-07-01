// Auth guard. Requires a valid access token; attaches req.userId.
import { verifyAccessToken } from '../lib/security.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth: sets req.userId if a valid token is present, else continues.
export function optionalAuth(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) {
    try { req.userId = verifyAccessToken(token).sub; } catch { /* ignore */ }
  }
  next();
}
