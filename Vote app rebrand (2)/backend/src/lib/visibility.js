// Visibility & follow-graph helpers.
// A CLOSE_FRIENDS decision is visible only to the author and to *mutuals*
// (users who follow the author AND are followed back).
import { prisma } from './prisma.js';

// Prisma `where` fragment for feed queries, given the viewer.
export function feedVisibilityWhere(viewerId) {
  return {
    OR: [
      { audience: 'EVERYONE' },
      { authorId: viewerId },
      {
        audience: 'CLOSE_FRIENDS',
        author: {
          AND: [
            { following: { some: { followingId: viewerId } } }, // author follows viewer
            { followers: { some: { followerId: viewerId } } },  // viewer follows author
          ],
        },
      },
    ],
  };
}

export async function areMutual(aId, bId) {
  if (aId === bId) return true;
  const [ab, ba] = await Promise.all([
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: aId, followingId: bId } }, select: { id: true } }),
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: bId, followingId: aId } }, select: { id: true } }),
  ]);
  return Boolean(ab && ba);
}

// Can `viewerId` see this decision object (must include authorId + audience)?
export async function canView(viewerId, decision) {
  if (!decision) return false;
  if (decision.audience === 'EVERYONE') return true;
  if (decision.authorId === viewerId) return true;
  return areMutual(viewerId, decision.authorId);
}
