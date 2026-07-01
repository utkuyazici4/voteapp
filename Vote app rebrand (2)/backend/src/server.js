// HTTP + WebSocket bootstrap.
import http from 'http';
import { createApp } from './app.js';
import { config } from './config.js';
import { attachRealtime } from './realtime.js';
import { prisma } from './lib/prisma.js';

const app = createApp();
const server = http.createServer(app);
attachRealtime(server); // live vote tallies over WebSocket

server.listen(config.port, () => {
  console.log(`Vote API listening on :${config.port} (${config.isProd ? 'production' : 'development'})`);
});

// Graceful shutdown
async function shutdown(sig) {
  console.log(`\n${sig} received — shutting down`);
  server.close(async () => { await prisma.$disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
