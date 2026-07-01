// Dev seed data. Run: npm run seed  (after migrate)
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/security.js';

async function main() {
  const pw = await hashPassword('Passw0rd!');
  const mk = (handle, name, extra = {}) => prisma.user.upsert({
    where: { email: `${handle}@vote.dev` },
    update: {},
    create: { handle, name, email: `${handle}@vote.dev`, passwordHash: pw, ...extra },
  });

  const utku = await mk('utku', 'Utku', { gender: 'Men', birthYear: 1997, xp: 320, level: 3, streak: 23 });
  const ece = await mk('ece', 'Ece', { gender: 'Women', birthYear: 1999, verified: true, xp: 540, level: 4 });
  const deniz = await mk('deniz', 'Deniz', { gender: 'Women', birthYear: 1992, xp: 210, level: 2 });

  // utku <-> ece are mutual (close friends); deniz follows utku only
  const follow = (a, b) => prisma.follow.upsert({ where: { followerId_followingId: { followerId: a, followingId: b } }, update: {}, create: { followerId: a, followingId: b } });
  await follow(utku.id, ece.id); await follow(ece.id, utku.id);
  await follow(deniz.id, utku.id);

  const dress = await prisma.decision.create({
    data: {
      authorId: ece.id, question: 'Which dress for the wedding?', hint: 'Saturday night · formal',
      category: 'Fashion', audience: 'EVERYONE', closesAt: new Date(Date.now() + 86400_000),
      options: { create: [
        { tag: 'A', label: 'Emerald', imageUrl: 'https://picsum.photos/seed/dressA/800/1000' },
        { tag: 'B', label: 'Navy sequin', imageUrl: 'https://picsum.photos/seed/dressB/800/1000' },
      ] },
    },
    include: { options: true },
  });
  // a couple of votes
  await prisma.vote.create({ data: { decisionId: dress.id, optionId: dress.options[0].id, userId: utku.id } });
  await prisma.vote.create({ data: { decisionId: dress.id, optionId: dress.options[1].id, userId: deniz.id } });

  // a close-friends-only decision by utku (only ece can see it)
  await prisma.decision.create({
    data: {
      authorId: utku.id, question: 'These sneakers for the trip?', hint: 'Only my close friends',
      category: 'Fashion', audience: 'CLOSE_FRIENDS', closesAt: new Date(Date.now() + 3 * 3600_000),
      options: { create: [
        { tag: 'A', label: 'White', imageUrl: 'https://picsum.photos/seed/shoeA/800/1000' },
        { tag: 'B', label: 'Black', imageUrl: 'https://picsum.photos/seed/shoeB/800/1000' },
      ] },
    },
  });

  console.log('Seed complete. Login: ece@vote.dev / Passw0rd!');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
