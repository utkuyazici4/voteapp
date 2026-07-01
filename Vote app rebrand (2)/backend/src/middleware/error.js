import { config } from '../config.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Central error handler. Never leaks stack traces or internals in production.
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : (err.publicMessage || err.message || 'Request failed'),
    ...(config.isProd ? {} : { debug: err.message }),
  });
}

// Helper to throw controlled, client-safe errors.
export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  return e;
}
