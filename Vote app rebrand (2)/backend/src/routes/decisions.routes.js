// Decisions: feed (paginated + visibility-filtered), create (image-required),
// read, delete, cast vote (one per user), and results (demographic breakdown).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { cleanText } from '../lib/security.js';
import { feedVisibilityWhere, canView } from '../lib/visibility.js';
import { decisionInclude, serializeDecision, ageBucket } from '../lib/serialize.js';
import { broadcastTally } from '../realtime.js';

const router = Router();
router.use(requireAuth); // every decision endpoint requires a signed-in user

// Award XP and handle level-ups. Kept server-side so clients can't inflate it.
async function awardXp(userId, amount) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { xp: true, level: true } });
  let xp = u.xp + amount, level = u.level;
  while (xp >= level * 250) { xp -= level * 250; level++; }
  await prisma.user.update({ where: { id: userId }, data: { xp, level } });
}

async function notify(recipientId, actorId, type, body) {
  if (recipientId === actorId) return;
  await prisma.notification.create({ data: { recipientId, type, body } });
}

/* ───────────── FEED ───────────── */
const feedQuery = z.object({
  tab: z.enum(['foryou', 'following']).default('foryou'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});
router.get('/', validate({ query: feedQuery }), async (req, res, next) => {
  try {
    const { tab, cursor, limit } = req.query;
    let where = feedVisibilityWhere(req.userId);
    if (tab === 'following') {
      where = { AND: [where, { author: { followers: { some: { followerId: req.userId } } } }] };
    }
    const rows = await prisma.decision.findMany({
      where,
      include: decisionInclude(req.userId),
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(d => serializeDecision(d, req.userId));
    res.json({ items, nextCursor: hasMore ? rows[limit - 1].id : null });
  } catch (e) { next(e); }
});

/* ───────────── CREATE (image required) ───────────── */
const optionSchema = z.object({
  imageUrl: z.string().url().max(2048),      // required — enforced by schema
  label: z.string().trim().max(40).optional(),
});
const createSchema = z.object({
  question: z.string().trim().min(3).max(200),
  hint: z.string().trim().max(120).optional(),
  category: z.string().trim().min(1).max(40),
  durationHours: z.coerce.number().int().min(1).max(168).default(24),
  audience: z.enum(['EVERYONE', 'CLOSE_FRIENDS']).default('EVERYONE'),
  optionA: optionSchema,
  optionB: optionSchema,
});
const createLimiter = rateLimit({ windowMs: 60 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

router.post('/', createLimiter, validate({ body: createSchema }), async (req, res, next) => {
  try {
    const b = req.body;
    // Defence in depth: a vote cannot be shared without both images.
    if (!b.optionA.imageUrl || !b.optionB.imageUrl) throw httpError(422, 'Both option images are required');
    const closesAt = new Date(Date.now() + b.durationHours * 3600_000);
    const decision = await prisma.decision.create({
      data: {
        authorId: req.userId,
        question: cleanText(b.question, 200),
        hint: b.hint ? cleanText(b.hint, 120) : null,
        category: cleanText(b.category, 40),
        audience: b.audience,
        closesAt,
        options: {
          create: [
            { tag: 'A', imageUrl: b.optionA.imageUrl, label: b.optionA.label ? cleanText(b.optionA.label, 40) : null },
            { tag: 'B', imageUrl: b.optionB.imageUrl, label: b.optionB.label ? cleanText(b.optionB.label, 40) : null },
          ],
        },
      },
      include: decisionInclude(req.userId),
    });
    await awardXp(req.userId, 15);
    res.status(201).json({ decision: serializeDecision(decision, req.userId) });
  } catch (e) { next(e); }
});

/* ───────────── READ ONE ───────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const d = await prisma.decision.findUnique({ where: { id: req.params.id }, include: decisionInclude(req.userId) });
    if (!d) throw httpError(404, 'Decision not found');
    if (!(await canView(req.userId, d))) throw httpError(403, 'Not allowed to view this');
    res.json({ decision: serializeDecision(d, req.userId) });
  } catch (e) { next(e); }
});

/* ───────────── DELETE (author only) ───────────── */
router.delete('/:id', async (req, res, next) => {
  try {
    const d = await prisma.decision.findUnique({ where: { id: req.params.id }, select: { authorId: true } });
    if (!d) throw httpError(404, 'Decision not found');
    if (d.authorId !== req.userId) throw httpError(403, 'Only the author can delete this');
    await prisma.decision.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ───────────── VOTE (one per user, must be able to view, must be open) ───────────── */
const voteLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
router.post('/:id/votes', voteLimiter, validate({ body: z.object({ tag: z.enum(['A', 'B']) }) }), async (req, res, next) => {
  try {
    const d = await prisma.decision.findUnique({
      where: { id: req.params.id },
      include: { options: { select: { id: true, tag: true } } },
    });
    if (!d) throw httpError(404, 'Decision not found');
    if (!(await canView(req.userId, d))) throw httpError(403, 'Not allowed to vote on this');
    if (new Date(d.closesAt) < new Date()) throw httpError(409, 'Voting has closed');
    const option = d.options.find(o => o.tag === req.body.tag);
    if (!option) throw httpError(400, 'Invalid option');

    try {
      await prisma.vote.create({ data: { decisionId: d.id, optionId: option.id, userId: req.userId } });
    } catch (e) {
      if (e.code === 'P2002') throw httpError(409, 'You already voted on this'); // unique(decisionId,userId)
      throw e;
    }

    await awardXp(req.userId, 2);
    await notify(d.authorId, req.userId, 'vote', 'Someone voted on your decision');

    // fresh tally → broadcast to live subscribers
    const full = await prisma.decision.findUnique({ where: { id: d.id }, include: decisionInclude(req.userId) });
    const payload = serializeDecision(full, req.userId);
    broadcastTally(d.id, { totalVotes: payload.totalVotes, options: payload.options.map(o => ({ tag: o.tag, count: o.count })) });
    res.status(201).json({ decision: payload });
  } catch (e) { next(e); }
});

/* ───────────── RESULTS (tallies + demographic breakdown) ───────────── */
router.get('/:id/results', async (req, res, next) => {
  try {
    const d = await prisma.decision.findUnique({ where: { id: req.params.id }, include: decisionInclude(req.userId) });
    if (!d) throw httpError(404, 'Decision not found');
    if (!(await canView(req.userId, d))) throw httpError(403, 'Not allowed');
    const base = serializeDecision(d, req.userId);
    if (!base.hasVoted && d.authorId !== req.userId) throw httpError(403, 'Vote first to see results');

    const votes = await prisma.vote.findMany({
      where: { decisionId: d.id },
      select: { option: { select: { tag: true } }, user: { select: { gender: true, birthYear: true } } },
    });
    const bucket = (keyFn) => {
      const map = {};
      for (const v of votes) {
        const key = keyFn(v.user); if (!key) continue;
        (map[key] ??= { A: 0, B: 0 })[v.option.tag]++;
      }
      return Object.entries(map).map(([k, c]) => {
        const t = c.A + c.B;
        return { k, share: Math.round((t / votes.length) * 100), a: t ? Math.round((c.A / t) * 100) : 0, b: t ? Math.round((c.B / t) * 100) : 0 };
      });
    };
    res.json({
      decision: base,
      breakdown: { byGender: bucket(u => u.gender), byAge: bucket(u => ageBucket(u.birthYear)) },
    });
  } catch (e) { next(e); }
});

export default router;
