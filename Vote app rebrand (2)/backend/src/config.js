// Centralised, validated configuration. Fails fast if secrets are missing.
import dotenv from 'dotenv';
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v || v.startsWith('change-me')) {
    throw new Error(`[config] Missing/insecure env var: ${name}. See .env.example.`);
  }
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: required('DATABASE_URL'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: parseInt(process.env.ACCESS_TOKEN_TTL || '900', 10),
    refreshTtl: parseInt(process.env.REFRESH_TOKEN_TTL || '2592000', 10),
  },

  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),

  cookie: {
    domain: process.env.COOKIE_DOMAIN || 'localhost',
    secure: process.env.COOKIE_SECURE === 'true' || isProd,
  },

  uploads: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxBytes: parseInt(process.env.MAX_UPLOAD_BYTES || '5242880', 10),
    allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
  },
};
