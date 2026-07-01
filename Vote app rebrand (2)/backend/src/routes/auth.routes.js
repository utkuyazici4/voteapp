// Auth: register, login, refresh (rotating), logout, me.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma, publicUser } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { config } from '../config.js';
import {
  hashPassword, verifyPassword, dummyVerify, signAccessToken,
  issueRefreshToken, sha256, cleanText,
} from '../lib/security.js';

const router = Router();

// Tight rate limit on auth endpoints — anti brute-force / credential stuffing.
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

const REFRESH_COOKIE = 'vote_rt';
function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,                    // not readable by JS → mitigates XSS token theft
    secure: config.cookie.secure,      // HTTPS-only in production
    sameSite: 'strict',                // CSRF mitigation
    domain: config.cookie.domain,
    path: '/api/auth',
    maxAge: config.jwt.refreshTtl * 1000,
  });
}

async function issueSession(res, userId) {
  const { token, tokenHash, expiresAt } = issueRefreshToken();
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  setRefreshCookie(res, token);
  return signAccessToken(userId);
}

const registerSchema = z.object({
  handle: z.string().trim().min(3).max(20).regex(/^[a-z0-9_.]+$/i, 'letters, numbers, _ or . only'),
  name: z.string().trim().min(1).max(40),
  email: z.string().trim().toLowerCase().email().max(160),
  // strong password policy
  password: z.string().min(8).max(128)
    .regex(/[a-z]/, 'needs a lowercase letter')
    .regex(/[A-Z]/, 'needs an uppercase letter')
    .regex(/[0-9]/, 'needs a number'),
});

router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const { handle, name, email, password } = req.body;
    const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { handle }] }, select: { id: true } });
    if (exists) throw httpError(409, 'Email or handle already in use');
    const user = await prisma.user.create({
      data: { handle, name: cleanText(name, 40), email, passwordHash: await hashPassword(password) },
      select: publicUser,
    });
    const accessToken = await issueSession(res, user.id);
    res.status(201).json({ user, accessToken });
  } catch (e) { next(e); }
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    // Same generic error + always run a hash compare → avoids user-enumeration/timing leaks.
    const ok = user ? await verifyPassword(password, user.passwordHash)
                     : await dummyVerify(password);
    if (!user || !ok) throw httpError(401, 'Invalid email or password');
    const accessToken = await issueSession(res, user.id);
    const { passwordHash, ...safe } = user;
    res.json({ user: safe, accessToken });
  } catch (e) { next(e); }
});

// Rotating refresh: old token is revoked, a new one issued.
router.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw httpError(401, 'No session');
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) throw httpError(401, 'Session expired');
    await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    const accessToken = await issueSession(res, record.userId);
    res.json({ accessToken });
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(raw) }, data: { revokedAt: new Date() } });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: config.cookie.domain });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: publicUser });
    if (!user) throw httpError(404, 'User not found');
    res.json({ user });
  } catch (e) { next(e); }
});

export default router;
