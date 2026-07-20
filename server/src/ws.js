// WebSocket delivery. Clients authenticate with their session token as the
// first message (keeps tokens out of URLs/access logs). Cross-pod fanout comes
// from the store's pubsub: every pod receives every event and delivers it to
// whichever recipients are connected to it.
import { WebSocketServer } from 'ws';

export function attachWs(httpServer, store) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const socketsByUser = new Map(); // userId -> Set<ws>

  store.subscribe((event) => {
    const { recipients, ...payload } = event;
    const raw = JSON.stringify(payload);
    for (const uid of recipients || []) {
      for (const ws of socketsByUser.get(uid) || []) {
        if (ws.readyState === ws.OPEN) ws.send(raw);
      }
    }
  });

  wss.on('connection', (ws) => {
    let userId = null;
    const authTimeout = setTimeout(() => { if (!userId) ws.close(4001, 'auth-timeout'); }, 10_000);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'auth' && !userId) {
        const uid = typeof msg.token === 'string' ? await store.getSession(msg.token) : null;
        if (!uid) return ws.close(4003, 'bad-token');
        userId = uid;
        ws.sessionToken = msg.token;
        clearTimeout(authTimeout);
        if (!socketsByUser.has(uid)) socketsByUser.set(uid, new Set());
        socketsByUser.get(uid).add(ws);
        ws.send(JSON.stringify({ type: 'ready' }));
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (userId) {
        const set = socketsByUser.get(userId);
        set?.delete(ws);
        if (set?.size === 0) socketsByUser.delete(userId);
      }
    });
  });

  // Heartbeat: drop dead connections, and re-check that the session behind each
  // socket still exists. A socket authenticates once at connect time, so
  // without this a logged-out (or deleted) account would keep receiving live
  // events for as long as the tab stayed open.
  setInterval(async () => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      if (ws.sessionToken) {
        try {
          if (!(await store.getSession(ws.sessionToken))) { ws.close(4003, 'session-revoked'); continue; }
        } catch { /* store blip: keep the socket, the next tick re-checks */ }
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000).unref();
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  return wss;
}
