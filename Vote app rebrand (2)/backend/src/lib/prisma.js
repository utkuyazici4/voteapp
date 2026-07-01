// Single shared PrismaClient instance. Prisma uses parameterised queries,
// which prevents SQL injection by construction.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
});

// Fields safe to expose to clients — NEVER include passwordHash.
export const publicUser = {
  id: true, handle: true, name: true, avatarColor: true,
  verified: true, influencer: true, xp: true, level: true, streak: true,
};
