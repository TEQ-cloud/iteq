// Dev-mode store: everything in process memory. Mirrors the prod store's
// interface (Postgres + Redis) so the API code is identical in both modes.
import { EventEmitter } from 'node:events';
import { config } from './config.js';

export function createMemoryStore() {
  const users = new Map();          // id -> user
  const usersByName = new Map();    // username -> id
  const chats = new Map();          // chatId -> {id, storage, createdAt, lastTs, members: Map<userId, {wrappedKey, encName}>}
  const sessions = new Map();       // token -> {userId, expires}
  const fails = new Map();          // username -> {count, lockedUntil}
  const rateLimits = new Map();     // key -> {count, resetAt}
  const npMsgs = new Map();         // chatId -> Map<msgId, msg>
  const npFiles = new Map();        // fileId -> {meta, chunks: Buffer[]}
  const pushSubs = new Map();       // endpoint -> {userId, sub}
  const npReceipts = new Map();     // chatId -> Map<userId, receipt>  (RAM chats)
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  return {
    async init() {},

    // --- accounts ---
    async createUser(u) {
      if (usersByName.has(u.username)) return null;
      users.set(u.id, u);
      usersByName.set(u.username, u.id);
      return u;
    },
    async getUserByName(username) {
      const id = usersByName.get(username);
      return id ? users.get(id) : null;
    },
    async getUserById(id) {
      return users.get(id) || null;
    },
    async setUserStatus(id, status) {
      const u = users.get(id);
      if (u) u.status = status;
    },
    async touchUser(id, ts) {
      const u = users.get(id);
      if (u) u.lastSeen = ts;
    },
    async listPendingUsers() {
      return [...users.values()].filter((u) => u.status === 'pending')
        .map((u) => ({ id: u.id, username: u.username, createdAt: u.createdAt }));
    },
    async deleteUser(id) {
      const u = users.get(id);
      if (!u) return;
      users.delete(id);
      usersByName.delete(u.username);
      for (const [tok, s] of sessions) if (s.userId === id) sessions.delete(tok);
      for (const [ep, s] of pushSubs) if (s.userId === id) pushSubs.delete(ep);
    },

    // --- web push subscriptions ---
    async addPushSub(userId, sub) {
      pushSubs.set(sub.endpoint, { userId, sub });
      // Cap devices per account (see the prod store for the rationale).
      const mine = [...pushSubs.entries()].filter(([, s]) => s.userId === userId);
      for (const [ep] of mine.slice(0, Math.max(0, mine.length - config.maxPushSubsPerUser))) pushSubs.delete(ep);
    },
    async listPushSubs(userId) {
      return [...pushSubs.values()].filter((s) => s.userId === userId).map((s) => s.sub);
    },
    // userId scopes the delete to its owner; omitted only by internal cleanup.
    async delPushSub(endpoint, userId) {
      const s = pushSubs.get(endpoint);
      if (s && (!userId || s.userId === userId)) pushSubs.delete(endpoint);
    },

    // --- chats ---
    async createChat({ id, storage, createdAt, members }) {
      const m = new Map();
      for (const mem of members) m.set(mem.userId, { wrappedKey: mem.wrappedKey, encName: mem.encName || null });
      chats.set(id, { id, storage, createdAt, lastTs: createdAt, members: m });
    },
    async getChat(chatId) {
      const c = chats.get(chatId);
      if (!c) return null;
      return { id: c.id, storage: c.storage, createdAt: c.createdAt, lastTs: c.lastTs, memberIds: [...c.members.keys()] };
    },
    async getMember(chatId, userId) {
      return chats.get(chatId)?.members.get(userId) || null;
    },
    async listChats(userId) {
      const out = [];
      for (const c of chats.values()) {
        const mine = c.members.get(userId);
        if (!mine) continue;
        const peerId = [...c.members.keys()].find((k) => k !== userId);
        const peer = users.get(peerId);
        out.push({
          id: c.id, storage: c.storage, createdAt: c.createdAt, lastTs: c.lastTs,
          wrappedKey: mine.wrappedKey, encName: mine.encName,
          peer: peer ? { id: peer.id, username: peer.username, pubJwk: peer.pubJwk } : null,
        });
      }
      out.sort((a, b) => b.lastTs - a.lastTs);
      return out;
    },
    async setChatName(chatId, userId, encName) {
      const m = chats.get(chatId)?.members.get(userId);
      if (m) m.encName = encName;
    },
    async touchChat(chatId, ts) {
      const c = chats.get(chatId);
      if (c) c.lastTs = ts;
    },

    // --- sessions ---
    async createSession(tok, userId) {
      sessions.set(tok, { userId, expires: Date.now() + config.sessionTtlMs });
    },
    async getSession(tok) {
      const s = sessions.get(tok);
      if (!s) return null;
      if (Date.now() > s.expires) { sessions.delete(tok); return null; }
      return s.userId;
    },
    async deleteSession(tok) {
      sessions.delete(tok);
    },

    // --- login rate limiting ---
    async isLocked(username) {
      const f = fails.get(username);
      return f && f.lockedUntil && Date.now() < f.lockedUntil ? f.lockedUntil : null;
    },
    async authFail(username) {
      const f = fails.get(username) || { count: 0, lockedUntil: 0 };
      f.count += 1;
      if (f.count >= config.maxLoginFails) { f.lockedUntil = Date.now() + config.lockoutMs; f.count = 0; }
      fails.set(username, f);
      return f.lockedUntil && Date.now() < f.lockedUntil ? f.lockedUntil : null;
    },
    async authOk(username) {
      fails.delete(username);
    },

    // --- generic fixed-window counter (per-ip abuse limits) ---
    async hitRateLimit(key, windowMs) {
      const now = Date.now();
      const cur = rateLimits.get(key);
      if (!cur || now > cur.resetAt) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return 1;
      }
      cur.count += 1;
      return cur.count;
    },
    async countPendingUsers() {
      return [...users.values()].filter((u) => u.status === 'pending').length;
    },

    // --- non-persistent (RAM) chat data ---
    async npAddMsg(chatId, msg) {
      if (!npMsgs.has(chatId)) npMsgs.set(chatId, new Map());
      npMsgs.get(chatId).set(msg.id, msg);
    },
    async npListMsgs(chatId, limit = 500) {
      const m = npMsgs.get(chatId);
      if (!m) return [];
      return [...m.values()].sort((a, b) => a.ts - b.ts).slice(-limit);
    },
    async npGetMsg(chatId, msgId) {
      return npMsgs.get(chatId)?.get(msgId) || null;
    },
    async npDelMsg(chatId, msgId) {
      const m = npMsgs.get(chatId);
      const msg = m?.get(msgId);
      if (!msg) return null;
      m.delete(msgId);
      if (msg.file?.fileId) await this.npDelFile(chatId, msg.file.fileId);
      return msg;
    },
    async npFileInit(chatId, fileId, meta) {
      npFiles.set(fileId, { meta, chunks: [] });
    },
    async npFilePutChunk(chatId, fileId, n, buf) {
      const f = npFiles.get(fileId);
      if (!f) throw new Error('no-file');
      f.chunks[n] = buf;
    },
    async npFileMeta(chatId, fileId) {
      return npFiles.get(fileId)?.meta || null;
    },
    async npFileSetMeta(chatId, fileId, meta) {
      const f = npFiles.get(fileId);
      if (f) f.meta = meta;
    },
    async npFileChunk(chatId, fileId, n) {
      return npFiles.get(fileId)?.chunks[n] || null;
    },
    async npDelFile(chatId, fileId) {
      npFiles.delete(fileId);
    },
    async npSetReceipt(chatId, userId, receipt) {
      if (!npReceipts.has(chatId)) npReceipts.set(chatId, new Map());
      npReceipts.get(chatId).set(userId, receipt);
    },
    async npGetReceipts(chatId) {
      return [...(npReceipts.get(chatId)?.values() || [])];
    },
    async npUsage(chatId) {
      let total = 0;
      for (const f of npFiles.values()) {
        if (f.meta.chatId === chatId) total += f.meta.size;
      }
      return total;
    },

    // --- pubsub (cross-pod fanout in prod; local emitter in dev) ---
    async publish(event) {
      bus.emit('event', event);
    },
    subscribe(fn) {
      bus.on('event', fn);
    },

    // Inactive-account cleanup: the account and every chat it is part of go.
    // Returns the ids of removed chats so the caller can purge PVC data too.
    async sweepAccounts(nowTs) {
      const removedChats = [];
      for (const u of [...users.values()]) {
        const lastSeen = u.lastSeen || u.createdAt;
        if (nowTs - lastSeen <= config.accountRetentionMs) continue;
        for (const c of [...chats.values()]) {
          if (!c.members.has(u.id)) continue;
          chats.delete(c.id);
          npMsgs.delete(c.id);
          npReceipts.delete(c.id);
          for (const [fileId, f] of npFiles) if (f.meta.chatId === c.id) npFiles.delete(fileId);
          removedChats.push(c.id);
        }
        await this.deleteUser(u.id);
      }
      return removedChats;
    },

    // --- retention sweep for RAM data ---
    async sweep(nowTs) {
      for (const [chatId, m] of npMsgs) {
        for (const [id, msg] of m) {
          if (nowTs - msg.ts > config.retentionMs) {
            m.delete(id);
            if (msg.file?.fileId) npFiles.delete(msg.file.fileId);
          }
        }
        if (m.size === 0) npMsgs.delete(chatId);
      }
      for (const [fileId, f] of npFiles) {
        if (f.meta.retainUntil && nowTs > f.meta.retainUntil) npFiles.delete(fileId);
        else if (!f.meta.complete && nowTs - f.meta.createdAt > 24 * 3600 * 1000) npFiles.delete(fileId);
      }
      for (const [chatId, m] of npReceipts) {
        for (const [uid, r] of m) if (nowTs - r.ts > config.retentionMs) m.delete(uid);
        if (m.size === 0) npReceipts.delete(chatId);
      }
    },
  };
}
