// Password hashing (bcrypt) + JWT signing/verification + token hashing.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config.js';

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// A valid precomputed hash to compare against when a user is NOT found — keeps
// login timing constant and prevents user enumeration. (bcryptjs = pure JS,
// no native build → reliable on any host.)
const DUMMY_HASH = bcrypt.hashSync('vote-not-a-real-password', BCRYPT_ROUNDS);
export function dummyVerify(plain) {
  return bcrypt.compare(plain, DUMMY_HASH);
}

// Short-lived access token (sent in Authorization: Bearer <token>).
export function signAccessToken(userId) {
  return jwt.sign({ sub: userId, typ: 'access' }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
  });
}
export function verifyAccessToken(token) {
  const p = jwt.verify(token, config.jwt.accessSecret);
  if (p.typ !== 'access') throw new Error('wrong token type');
  return p;
}

// Long-lived refresh token. We store only its sha256 hash server-side so a DB
// leak can't be replayed. Rotated on every /refresh.
export function issueRefreshToken() {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtl * 1000);
  return { token, tokenHash, expiresAt };
}
export function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

// Trim + collapse whitespace; strip control chars. Defence-in-depth on top of
// zod validation and (client-side) output escaping.
export function cleanText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
