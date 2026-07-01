// Shapes a Decision row into the client payload: per-option tallies,
// percentages, the viewer's own pick, and counts.
import { publicUser } from './prisma.js';

// Standard include used by feed + single-decision queries.
export function decisionInclude(viewerId) {
  return {
    author: { select: publicUser },
    options: {
      orderBy: { tag: 'asc' },
      include: { _count: { select: { votes: true } } },
    },
    _count: { select: { votes: true, comments: true } },
    votes: viewerId
      ? { where: { userId: viewerId }, select: { option: { select: { tag: true } } } }
      : false,
  };
}

// Percentages that always sum to 100 (largest-remainder on 2 options).
function percentages(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map(c => (c / total) * 100);
  const floor = raw.map(Math.floor);
  let rem = 100 - floor.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [i, v - floor[i]]).sort((a, b) => b[1] - a[1]);
  const out = [...floor];
  for (let k = 0; k < rem; k++) out[order[k % order.length][0]]++;
  return out;
}

export function serializeDecision(d, viewerId) {
  const counts = d.options.map(o => o._count.votes);
  const pcts = percentages(counts);
  const myTag = d.votes && d.votes[0] ? d.votes[0].option.tag : null;
  const msLeft = new Date(d.closesAt).getTime() - Date.now();

  return {
    id: d.id,
    author: d.author,
    question: d.question,
    hint: d.hint,
    category: d.category,
    audience: d.audience,
    closesAt: d.closesAt,
    open: msLeft > 0,
    timeLeftMs: Math.max(0, msLeft),
    totalVotes: d._count.votes,
    commentCount: d._count.comments,
    myVote: myTag,                 // null until the viewer votes
    hasVoted: Boolean(myTag),
    // percentages are only revealed once the viewer has voted (or owns it)
    options: d.options.map((o, i) => ({
      id: o.id,
      tag: o.tag,
      label: o.label,
      imageUrl: o.imageUrl,
      count: counts[i],
      pct: (myTag || d.authorId === viewerId) ? pcts[i] : null,
    })),
    createdAt: d.createdAt,
  };
}

// Age bucket from birth year.
export function ageBucket(birthYear) {
  if (!birthYear) return null;
  const age = new Date().getFullYear() - birthYear;
  if (age < 25) return '18–24';
  if (age < 35) return '25–34';
  return '35+';
}
