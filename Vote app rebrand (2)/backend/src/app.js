// Express app: security middleware chain + route mounting.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { notFound, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import decisionRoutes from './routes/decisions.routes.js';
import commentRoutes from './routes/comments.routes.js';
import uploadRoutes from './routes/uploads.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind Railway/AWS proxy — needed for rate-limit + secure cookies

  // Security headers (CSP, HSTS, noSniff, frameguard, etc.)
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow serving uploaded images
  }));

  // CORS — strict allowlist; credentials on for the refresh cookie.
  app.use(cors({
    origin(origin, cb) {
      // allow same-origin / server-to-server (no Origin header) and allowlisted apps
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));            // body size cap (anti-DoS)
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(hpp());                                     // HTTP parameter pollution
  if (!config.isProd) app.use(morgan('dev'));

  // Global rate limit — blunt anti-abuse ceiling.
  app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  app.use('/uploads/files', express.static(config.uploads.dir)); // served images
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/decisions', decisionRoutes);
  app.use('/api', commentRoutes);   // /api/decisions/:id/comments
  app.use('/api/uploads', uploadRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
