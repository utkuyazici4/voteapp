// Comments — only users who have voted on a decision may comment, and their
// pick (A/B) is attached to the comment (matches the product rule).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma, publicUser } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { cleanText } from '../lib/security.js';
import { canView } from '../lib/visibility.js';

const router = Router();
router.use(requireAuth);

router.get('/decisions/:id/comments', validate({ query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }) }), async (req, res, next) => {
  try {
    const d = await prisma.decision.findUnique({ where: { id: req.params.id }, select: { authorId: true, audience: true } });
    if (!d) throw httpError(404, 'Decision not found');
    if (!(await canView(req.userId, d))) throw httpError(403, 'Not allowed');
    const { cursor, limit } = req.query;
    const rows = await prisma.comment.findMany({
      where: { decisionId: req.params.id },
      include: { author: { select: publicUser } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    res.json({ items: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1].id : null });
  } catch (e) { next(e); }
});

const commentLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
router.post('/decisions/:id/comments', commentLimiter, validate({ body: z.object({ body: z.string().trim().min(1).max(500) }) }), async (req, res, next) => {
  try {
    const d = await prisma.decision.findUnique({ where: { id: req.params.id }, select: { authorId: true, audience: true } });
    if (!d) throw httpError(404, 'Decision not found');
    if (!(await canView(req.userId, d))) throw httpError(403, 'Not allowed');

    // voters-only: find this user's vote (also gives us their pick)
    const vote = await prisma.vote.findUnique({
      where: { decisionId_userId: { decisionId: req.params.id, userId: req.userId } },
      select: { option: { select: { tag: true } } },
    });
    if (!vote) throw httpError(403, 'Vote first to join the discussion');

    const comment = await prisma.comment.create({
      data: { decisionId: req.params.id, authorId: req.userId, body: cleanText(req.body.body, 500), pick: vote.option.tag },
      include: { author: { select: publicUser } },
    });
    if (d.authorId !== req.userId) {
      await prisma.notification.create({ data: { recipientId: d.authorId, type: 'comment', body: 'New comment on your decision' } });
    }
    res.status(201).json({ comment });
  } catch (e) { next(e); }
});

export default router;
