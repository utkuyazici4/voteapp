// WebSocket layer for live vote counts. Clients subscribe to a decision id and
// receive tally updates whenever someone votes. Auth is verified on connect.
import { WebSocketServer } from 'ws';
import { verifyAccessToken } from './lib/security.js';

let wss = null;
const rooms = new Map(); // decisionId -> Set<ws>

export function attachRealtime(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // token passed as ?token=... on the ws URL
    try {
      const url = new URL(req.url, 'http://localhost');
      verifyAccessToken(url.searchParams.get('token') || '');
    } catch {
      ws.close(4401, 'unauthorized');
      return;
    }
    ws.rooms = new Set();
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'subscribe' && typeof msg.decisionId === 'string') {
        join(msg.decisionId, ws);
      } else if (msg.type === 'unsubscribe' && typeof msg.decisionId === 'string') {
        leave(msg.decisionId, ws);
      }
    });
    ws.on('close', () => ws.rooms.forEach((id) => leave(id, ws)));
  });
}

function join(id, ws) {
  if (!rooms.has(id)) rooms.set(id, new Set());
  rooms.get(id).add(ws); ws.rooms.add(id);
}
function leave(id, ws) {
  rooms.get(id)?.delete(ws); ws.rooms?.delete(id);
}

// Called by the votes route after a successful vote.
export function broadcastTally(decisionId, tally) {
  const room = rooms.get(decisionId);
  if (!room) return;
  const payload = JSON.stringify({ type: 'tally', decisionId, tally });
  for (const ws of room) { if (ws.readyState === 1) ws.send(payload); }
}
