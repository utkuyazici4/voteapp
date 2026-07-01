// Users: profile, follow/unfollow, close-friends (mutuals), leaderboard,
// notifications, and streak dashboard.
import { Router } from 'express';
import { z } from 'zod';
import { prisma, publicUser } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

// NOTE: fixed paths declared before "/:id" so they aren't captured as an id.

/* ── Leaderboard (all-time / friends) ── */
router.get('/leaderboard', validate({ query: z.object({ scope: z.enum(['all', 'friends']).default('all'), limit: z.coerce.number().int().min(1).max(100).default(50) }) }), async (req, res, next) => {
  try {
    const where = req.query.scope === 'friends'
      ? { OR: [{ id: req.userId }, { followers: { some: { followerId: req.userId } } }] }
      : {};
    const users = await prisma.user.findMany({ where, orderBy: { xp: 'desc' }, take: req.query.limit, select: publicUser });
    res.json({ items: users.map((u, i) => ({ rank: i + 1, ...u, me: u.id === req.userId })) });
  } catch (e) { next(e); }
});

/* ── Close friends = mutual follows ── */
router.get('/me/close-friends', async (req, res, next) => {
  try {
    const iFollow = await prisma.follow.findMany({ where: { followerId: req.userId }, select: { followingId: true } });
    const ids = iFollow.map(f => f.followingId);
    if (!ids.length) return res.json({ items: [] });
    const back = await prisma.follow.findMany({ where: { followerId: { in: ids }, followingId: req.userId }, select: { followerId: true } });
    const mutualIds = back.map(f => f.followerId);
    const users = await prisma.user.findMany({ where: { id: { in: mutualIds } }, select: publicUser });
    res.json({ items: users });
  } catch (e) { next(e); }
});

/* ── Notifications ── */
router.get('/me/notifications', async (req, res, next) => {
  try {
    const items = await prisma.notification.findMany({ where: { recipientId: req.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const unread = await prisma.notification.count({ where: { recipientId: req.userId, read: false } });
    res.json({ items, unread });
  } catch (e) { next(e); }
});
router.post('/me/notifications/read', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({ where: { recipientId: req.userId, read: false }, data: { read: true } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── Streak dashboard (daily goal = 5 votes) ── */
router.get('/me/streak', async (req, res, next) => {
  try {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const votesToday = await prisma.vote.count({ where: { userId: req.userId, createdAt: { gte: startOfToday } } });
    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { streak: true } });
    res.json({ streak: me.streak, votesToday, dailyGoal: 5, goalMet: votesToday >= 5 });
  } catch (e) { next(e); }
});

/* ── Follow / unfollow ── */
router.post('/:id/follow', validate({ params: z.object({ id: z.string() }) }), async (req, res, next) => {
  try {
    if (req.params.id === req.userId) throw httpError(400, 'You cannot follow yourself');
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!target) throw httpError(404, 'User not found');
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: req.userId, followingId: req.params.id } },
      update: {},
      create: { followerId: req.userId, followingId: req.params.id },
    });
    await prisma.notification.create({ data: { recipientId: req.params.id, type: 'follow', body: 'You have a new follower' } });
    // mutual now? (both directions exist)
    const back = await prisma.follow.findUnique({ where: { followerId_followingId: { followerId: req.params.id, followingId: req.userId } }, select: { id: true } });
    res.json({ following: true, mutual: Boolean(back) });
  } catch (e) { next(e); }
});
router.delete('/:id/follow', validate({ params: z.object({ id: z.string() }) }), async (req, res, next) => {
  try {
    await prisma.follow.deleteMany({ where: { followerId: req.userId, followingId: req.params.id } });
    res.json({ following: false, mutual: false });
  } catch (e) { next(e); }
});

/* ── Public profile (+ derived counts, badges, mutual flag) ── */
router.get('/:id', validate({ params: z.object({ id: z.string() }) }), async (req, res, next) => {
  try {
    const id = req.params.id === 'me' ? req.userId : req.params.id;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { ...publicUser, _count: { select: { followers: true, following: true, decisions: true, votes: true } } },
    });
    if (!user) throw httpError(404, 'User not found');
    const [iFollow, followsMe] = await Promise.all([
      prisma.follow.findUnique({ where: { followerId_followingId: { followerId: req.userId, followingId: id } }, select: { id: true } }),
      prisma.follow.findUnique({ where: { followerId_followingId: { followerId: id, followingId: req.userId } }, select: { id: true } }),
    ]);
    res.json({
      user: {
        ...user,
        followers: user._count.followers,
        following: user._count.following,
        decisions: user._count.decisions,
        helped: user._count.votes,
        isFollowing: Boolean(iFollow),
        isMutual: Boolean(iFollow && followsMe),
        isMe: id === req.userId,
      },
    });
  } catch (e) { next(e); }
});

/* ── Own decisions grid ── */
router.get('/:id/decisions', validate({ params: z.object({ id: z.string() }) }), async (req, res, next) => {
  try {
    const id = req.params.id === 'me' ? req.userId : req.params.id;
    const rows = await prisma.decision.findMany({
      where: { authorId: id },
      orderBy: { createdAt: 'desc' },
      include: { options: { orderBy: { tag: 'asc' }, select: { imageUrl: true, tag: true } }, _count: { select: { votes: true } } },
      take: 30,
    });
    res.json({ items: rows });
  } catch (e) { next(e); }
});

export default router;
