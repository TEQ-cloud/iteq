// REST API. Everything the server stores or relays for chats is ciphertext the
// clients produced — the server only ever sees usernames, UUIDs, timestamps
// and sizes.
import express from 'express';
import { config } from './config.js';
import { pstore } from './pstore.js';
import { uuid, token, now, scryptHash, scryptVerify, validUsername, validId } from './util.js';
import { pushEnabled, pushToUsers } from './push.js';

const isEncBlob = (o) => o && typeof o === 'object' && typeof o.iv === 'string' && typeof o.ct === 'string';

export function createApi(store, bus) {
  const api = express.Router();
  api.use(express.json({ limit: '256kb' }));

  // ---------- auth ----------
  const isAdmin = (user) => config.adminUsers.includes(user.username);

  const requireAuth = async (req, res, next) => {
    const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
    const userId = tok ? await store.getSession(tok) : null;
    const user = userId ? await store.getUserById(userId) : null;
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    req.userId = user.id;
    req.user = user;
    req.token = tok;
    next();
  };

  // iTEQ is a closed service: pending accounts can log in and see the waiting
  // screen, but can't touch chats until an admin approves them.
  const requireActive = (req, res, next) => {
    if (req.user.status !== 'active') return res.status(403).json({ error: 'pending-approval' });
    next();
  };

  const requireAdmin = (req, res, next) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'not-admin' });
    next();
  };

  api.post('/auth/signup', async (req, res) => {
    const { username, authKey, pubJwk, encPriv } = req.body || {};
    if (!validUsername(username)) return res.status(400).json({ error: 'bad-username' });
    if (typeof authKey !== 'string' || !/^[0-9a-f]{64}$/.test(authKey)) return res.status(400).json({ error: 'bad-auth-key' });
    if (!pubJwk || typeof pubJwk !== 'object' || !isEncBlob(encPriv)) return res.status(400).json({ error: 'bad-keys' });
    const isAdminName = config.adminUsers.includes(username);
    if (isAdminName && config.adminSetupCode) {
      const { setupCode } = req.body;
      if (typeof setupCode !== 'string' || !setupCode) return res.status(403).json({ error: 'admin-code-required' });
      if (setupCode !== config.adminSetupCode) return res.status(403).json({ error: 'bad-admin-code' });
    }
    const status = isAdminName ? 'active' : 'pending';
    const ts = now();
    const user = await store.createUser({
      id: uuid(), username, authHash: scryptHash(authKey), pubJwk, encPriv, status, createdAt: ts, lastSeen: ts,
    });
    if (!user) return res.status(409).json({ error: 'username-taken' });
    const tok = token();
    await store.createSession(tok, user.id);
    res.json({ token: tok, user: { id: user.id, username, status, admin: isAdmin(user) }, pubJwk, encPriv });
  });

  api.post('/auth/login', async (req, res) => {
    const { username, authKey } = req.body || {};
    if (!validUsername(username) || typeof authKey !== 'string') return res.status(400).json({ error: 'bad-request' });
    const lockedUntil = await store.isLocked(username);
    if (lockedUntil) return res.status(429).json({ error: 'locked', until: lockedUntil });
    const user = await store.getUserByName(username);
    if (!user || !scryptVerify(authKey, user.authHash)) {
      const until = await store.authFail(username);
      return res.status(401).json({ error: 'bad-credentials', ...(until ? { locked: true, until } : {}) });
    }
    await store.authOk(username);
    await store.touchUser(user.id, now()); // inactivity clock resets on login
    const tok = token();
    await store.createSession(tok, user.id);
    res.json({ token: tok, user: { id: user.id, username, status: user.status, admin: isAdmin(user) }, pubJwk: user.pubJwk, encPriv: user.encPriv });
  });

  api.get('/me', requireAuth, async (req, res) => {
    await store.touchUser(req.user.id, now()); // called on every app boot
    res.json({ user: { id: req.user.id, username: req.user.username, status: req.user.status, admin: isAdmin(req.user) } });
  });

  // ---------- web push ----------
  api.get('/push/vapid', (_req, res) => {
    res.json({ enabled: pushEnabled(), publicKey: config.vapidPublicKey || null });
  });

  const validSub = (s) => s && typeof s === 'object' && typeof s.endpoint === 'string'
    && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 2048
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';

  api.post('/push/subscribe', requireAuth, requireActive, async (req, res) => {
    if (!pushEnabled()) return res.status(503).json({ error: 'push-disabled' });
    const { subscription } = req.body || {};
    if (!validSub(subscription)) return res.status(400).json({ error: 'bad-subscription' });
    await store.addPushSub(req.userId, subscription);
    res.json({ ok: true });
  });

  api.post('/push/unsubscribe', requireAuth, async (req, res) => {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string') return res.status(400).json({ error: 'bad-request' });
    await store.delPushSub(endpoint);
    res.json({ ok: true });
  });

  // ---------- admin: approval-gated registration ----------
  api.get('/admin/pending', requireAuth, requireAdmin, async (_req, res) => {
    res.json({ pending: await store.listPendingUsers() });
  });

  api.post('/admin/users/:id/approve', requireAuth, requireAdmin, async (req, res) => {
    const u = await store.getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: 'not-found' });
    await store.setUserStatus(u.id, 'active');
    await bus.publish({ type: 'account.approved', recipients: [u.id] });
    res.json({ ok: true });
  });

  api.delete('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const u = await store.getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: 'not-found' });
    if (u.status !== 'pending') return res.status(400).json({ error: 'not-pending' }); // only reject applicants
    await store.deleteUser(u.id);
    res.json({ ok: true });
  });

  api.post('/auth/logout', requireAuth, async (req, res) => {
    await store.deleteSession(req.token);
    res.json({ ok: true });
  });

  // ---------- users (no search: exact username only) ----------
  api.get('/users/:username', requireAuth, requireActive, async (req, res) => {
    if (!validUsername(req.params.username)) return res.status(400).json({ error: 'bad-username' });
    const u = await store.getUserByName(req.params.username);
    if (!u) return res.status(404).json({ error: 'not-found' });
    res.json({ id: u.id, username: u.username, pubJwk: u.pubJwk });
  });

  // ---------- chats ----------
  api.get('/me/chats', requireAuth, requireActive, async (req, res) => {
    res.json({ chats: await store.listChats(req.userId) });
  });

  api.post('/chats', requireAuth, requireActive, async (req, res) => {
    const { peerUsername, storage, wrappedKeyMe, wrappedKeyPeer, encName } = req.body || {};
    if (!validUsername(peerUsername)) return res.status(400).json({ error: 'bad-username' });
    if (storage !== 'ram' && storage !== 'pvc') return res.status(400).json({ error: 'bad-storage' });
    if (!isEncBlob(wrappedKeyMe) || !isEncBlob(wrappedKeyPeer)) return res.status(400).json({ error: 'bad-keys' });
    const peer = await store.getUserByName(peerUsername);
    if (!peer) return res.status(404).json({ error: 'not-found' });
    if (peer.id === req.userId) return res.status(400).json({ error: 'self-chat' });
    const chatId = uuid();
    await store.createChat({
      id: chatId, storage, createdAt: now(),
      members: [
        { userId: req.userId, wrappedKey: wrappedKeyMe, encName: isEncBlob(encName) ? encName : null },
        { userId: peer.id, wrappedKey: wrappedKeyPeer, encName: null },
      ],
    });
    await bus.publish({ type: 'chat.new', chatId, recipients: [peer.id] });
    res.json({ chatId });
  });

  const requireMember = async (req, res, next) => {
    if (!validId(req.params.chatId)) return res.status(400).json({ error: 'bad-id' });
    const chat = await store.getChat(req.params.chatId);
    if (!chat || !chat.memberIds.includes(req.userId)) return res.status(404).json({ error: 'not-found' });
    req.chat = chat;
    next();
  };

  api.patch('/chats/:chatId/name', requireAuth, requireActive, requireMember, async (req, res) => {
    if (!isEncBlob(req.body?.encName)) return res.status(400).json({ error: 'bad-name' });
    await store.setChatName(req.chat.id, req.userId, req.body.encName);
    res.json({ ok: true });
  });

  // ---------- messages ----------
  const dataFor = (chat) => (chat.storage === 'ram'
    ? {
        add: (m) => store.npAddMsg(chat.id, m),
        list: () => store.npListMsgs(chat.id),
        del: (id) => store.npDelMsg(chat.id, id),
        get: (id) => store.npGetMsg(chat.id, id),
        setReceipt: (uid, r) => store.npSetReceipt(chat.id, uid, r),
        getReceipts: () => store.npGetReceipts(chat.id),
      }
    : {
        add: (m) => pstore.addMsg(chat.id, m),
        list: () => pstore.listMsgs(chat.id),
        del: (id) => pstore.delMsg(chat.id, id),
        get: (id) => pstore.getMsg(chat.id, id),
        setReceipt: (uid, r) => pstore.setReceipt(chat.id, uid, r),
        getReceipts: () => pstore.getReceipts(chat.id),
      });

  api.get('/chats/:chatId/messages', requireAuth, requireActive, requireMember, async (req, res) => {
    res.json({ messages: await dataFor(req.chat).list() });
  });

  api.post('/chats/:chatId/messages', requireAuth, requireActive, requireMember, async (req, res) => {
    const { payload, replyTo, fileId } = req.body || {};
    if (!isEncBlob(payload) || payload.ct.length > 128 * 1024) return res.status(400).json({ error: 'bad-payload' });
    if (replyTo != null && !validId(replyTo)) return res.status(400).json({ error: 'bad-reply' });

    let file = null;
    if (fileId != null) {
      if (!validId(fileId)) return res.status(400).json({ error: 'bad-file' });
      const meta = req.chat.storage === 'ram'
        ? await store.npFileMeta(req.chat.id, fileId)
        : await pstore.fileMeta(req.chat.id, fileId);
      if (!meta || meta.chatId !== req.chat.id || !meta.complete) return res.status(400).json({ error: 'file-not-ready' });
      file = { fileId, size: meta.size, chunks: meta.chunks, encChunkSize: meta.encChunkSize, big: meta.big, encMeta: meta.encMeta, retainUntil: meta.retainUntil };
    }

    const ts = now();
    const msg = {
      id: uuid(), chatId: req.chat.id, senderId: req.userId, ts,
      payload, replyTo: replyTo || null, file,
      retainUntil: ts + config.retentionMs,
    };
    await dataFor(req.chat).add(msg);
    await store.touchChat(req.chat.id, ts);
    await bus.publish({ type: 'message.new', chatId: req.chat.id, msg, recipients: req.chat.memberIds });
    // Wake the other member's devices. No content — the server has none.
    pushToUsers(store, req.chat.memberIds.filter((id) => id !== req.userId), {
      type: 'message', chatId: req.chat.id,
    }).catch((e) => console.error('push:', e.message));
    res.json({ message: msg });
  });

  // ---------- read receipts ----------
  // The payload is ciphertext: the server relays and stores it without ever
  // learning which message was read. Receipts deliberately do NOT trigger
  // push notifications and do NOT touch the chat's activity timestamp — the
  // only new thing the server sees is timing it already saw when the reader's
  // client fetched the messages.
  api.post('/chats/:chatId/receipt', requireAuth, requireActive, requireMember, async (req, res) => {
    const { payload } = req.body || {};
    if (!isEncBlob(payload) || payload.ct.length > 4096) return res.status(400).json({ error: 'bad-payload' });
    const receipt = { userId: req.userId, payload, ts: now() };
    await dataFor(req.chat).setReceipt(req.userId, receipt);
    await bus.publish({ type: 'receipt', chatId: req.chat.id, receipt, recipients: req.chat.memberIds });
    res.json({ ok: true });
  });

  api.get('/chats/:chatId/receipts', requireAuth, requireActive, requireMember, async (req, res) => {
    res.json({ receipts: await dataFor(req.chat).getReceipts() });
  });

  api.delete('/chats/:chatId/messages/:msgId', requireAuth, requireActive, requireMember, async (req, res) => {
    if (!validId(req.params.msgId)) return res.status(400).json({ error: 'bad-id' });
    const d = dataFor(req.chat);
    const msg = await d.get(req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'not-found' });
    if (msg.senderId !== req.userId) return res.status(403).json({ error: 'not-yours' });
    await d.del(req.params.msgId);
    await bus.publish({ type: 'message.deleted', chatId: req.chat.id, msgId: msg.id, recipients: req.chat.memberIds });
    res.json({ ok: true });
  });

  // ---------- files (chunked, ciphertext only) ----------
  api.post('/chats/:chatId/files/init', requireAuth, requireActive, requireMember, async (req, res) => {
    const { size, chunks, encChunkSize, encMeta } = req.body || {};
    if (!Number.isInteger(size) || size <= 0 || !Number.isInteger(chunks) || chunks <= 0 ||
        !Number.isInteger(encChunkSize) || encChunkSize <= 0 || encChunkSize > config.chunkSize + 64 ||
        !isEncBlob(encMeta)) {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (chunks !== Math.ceil(size / encChunkSize)) return res.status(400).json({ error: 'bad-chunking' });

    const ram = req.chat.storage === 'ram';
    if (ram) {
      if (size > config.npFileMax) {
        return res.status(413).json({ error: 'needs-persistence', limit: config.npFileMax });
      }
      const usage = await store.npUsage(req.chat.id);
      if (usage + size > config.npChatMax) {
        return res.status(413).json({ error: 'chat-quota', limit: config.npChatMax, usage });
      }
    }
    const big = !ram && size > config.bigFileThreshold;
    const fileId = uuid();
    const meta = {
      fileId, chatId: req.chat.id, uploaderId: req.userId,
      size, chunks, encChunkSize, encMeta, big,
      received: 0, complete: false,
      createdAt: now(),
      retainUntil: now() + (big ? config.bigRetentionMs : config.retentionMs),
    };
    if (ram) await store.npFileInit(req.chat.id, fileId, meta);
    else await pstore.fileInit(req.chat.id, fileId, meta);
    res.json({ fileId, big, retainUntil: meta.retainUntil });
  });

  const rawBody = express.raw({ type: 'application/octet-stream', limit: config.chunkSize + 1024 });
  api.put('/chats/:chatId/files/:fileId/chunks/:n', requireAuth, requireActive, requireMember, rawBody, async (req, res) => {
    const { fileId } = req.params;
    const n = Number(req.params.n);
    if (!validId(fileId) || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'bad-request' });
    const ram = req.chat.storage === 'ram';
    const meta = ram ? await store.npFileMeta(req.chat.id, fileId) : await pstore.fileMeta(req.chat.id, fileId);
    if (!meta || meta.chatId !== req.chat.id || meta.uploaderId !== req.userId) return res.status(404).json({ error: 'not-found' });
    if (meta.complete || n >= meta.chunks) return res.status(400).json({ error: 'bad-chunk' });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'empty-chunk' });
    const expected = n === meta.chunks - 1 ? meta.size - n * meta.encChunkSize : meta.encChunkSize;
    if (buf.length !== expected) return res.status(400).json({ error: 'bad-chunk-size', expected });

    if (ram) await store.npFilePutChunk(req.chat.id, fileId, n, buf);
    else await pstore.filePutChunk(req.chat.id, fileId, n, buf, n * meta.encChunkSize);

    meta.received += buf.length;
    if (ram) await store.npFileSetMeta(req.chat.id, fileId, meta);
    else await pstore.fileSetMeta(req.chat.id, fileId, meta);
    res.json({ ok: true, received: meta.received });
  });

  api.post('/chats/:chatId/files/:fileId/complete', requireAuth, requireActive, requireMember, async (req, res) => {
    const { fileId } = req.params;
    const ram = req.chat.storage === 'ram';
    const meta = ram ? await store.npFileMeta(req.chat.id, fileId) : await pstore.fileMeta(req.chat.id, fileId);
    if (!meta || meta.uploaderId !== req.userId) return res.status(404).json({ error: 'not-found' });
    if (meta.received < meta.size) return res.status(400).json({ error: 'incomplete', received: meta.received, size: meta.size });
    meta.complete = true;
    meta.uploadedAt = now();
    if (ram) await store.npFileSetMeta(req.chat.id, fileId, meta);
    else await pstore.fileSetMeta(req.chat.id, fileId, meta);
    res.json({ ok: true, uploadedAt: meta.uploadedAt, big: meta.big, retainUntil: meta.retainUntil });
  });

  api.get('/chats/:chatId/files/:fileId/meta', requireAuth, requireActive, requireMember, async (req, res) => {
    const { fileId } = req.params;
    const meta = req.chat.storage === 'ram'
      ? await store.npFileMeta(req.chat.id, fileId)
      : await pstore.fileMeta(req.chat.id, fileId);
    if (!meta || meta.chatId !== req.chat.id) return res.status(404).json({ error: 'not-found' });
    res.json({ meta });
  });

  api.get('/chats/:chatId/files/:fileId/chunks/:n', requireAuth, requireActive, requireMember, async (req, res) => {
    const { fileId } = req.params;
    const n = Number(req.params.n);
    if (!validId(fileId) || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'bad-request' });
    const ram = req.chat.storage === 'ram';
    const meta = ram ? await store.npFileMeta(req.chat.id, fileId) : await pstore.fileMeta(req.chat.id, fileId);
    if (!meta || meta.chatId !== req.chat.id || !meta.complete || n >= meta.chunks) return res.status(404).json({ error: 'not-found' });
    res.setHeader('Content-Type', 'application/octet-stream');
    if (ram) {
      const buf = await store.npFileChunk(req.chat.id, fileId, n);
      if (!buf) return res.status(404).json({ error: 'gone' });
      res.send(buf);
    } else {
      const start = n * meta.encChunkSize;
      const end = Math.min(meta.size, start + meta.encChunkSize);
      pstore.fileChunkStream(req.chat.id, fileId, start, end).on('error', () => res.destroy()).pipe(res);
    }
  });

  return api;
}
