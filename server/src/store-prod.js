// Prod store: Postgres (CNPG) for account/chat metadata, Redis for sessions,
// rate limiting, cross-pod pubsub and ALL non-persistent (RAM) chat data.
// Redis runs with persistence disabled, so RAM chats genuinely live in memory
// and die with the Redis pod — exactly the promise made in the UI.
import pg from 'pg';
import { createClient, commandOptions } from 'redis';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text UNIQUE NOT NULL,
  auth_hash text NOT NULL,
  pub_jwk jsonb NOT NULL,
  enc_priv jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at bigint NOT NULL
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen bigint;
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY,
  storage text NOT NULL,
  created_at bigint NOT NULL,
  last_ts bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key jsonb NOT NULL,
  enc_name jsonb,
  PRIMARY KEY (chat_id, user_id)
);
`;

export function createProdStore() {
  const db = new pg.Pool({ connectionString: config.databaseUrl });
  const redis = createClient({ url: config.redisUrl });
  const sub = redis.duplicate();
  const CHANNEL = 'iteq:events';
  const rowUser = (r) => r && { id: r.id, username: r.username, authHash: r.auth_hash, pubJwk: r.pub_jwk, encPriv: r.enc_priv, status: r.status, createdAt: Number(r.created_at) };

  return {
    async init() {
      await db.query(SCHEMA);
      await redis.connect();
      await sub.connect();
    },

    // --- accounts ---
    async createUser(u) {
      try {
        await db.query(
          'INSERT INTO users (id, username, auth_hash, pub_jwk, enc_priv, status, created_at, last_seen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [u.id, u.username, u.authHash, u.pubJwk, u.encPriv, u.status, u.createdAt, u.lastSeen ?? u.createdAt]
        );
        return u;
      } catch (e) {
        if (e.code === '23505') return null; // username taken
        throw e;
      }
    },
    async setUserStatus(id, status) {
      await db.query('UPDATE users SET status=$2 WHERE id=$1', [id, status]);
    },
    async touchUser(id, ts) {
      await db.query('UPDATE users SET last_seen=$2 WHERE id=$1', [id, ts]);
    },
    async listPendingUsers() {
      const r = await db.query("SELECT id, username, created_at FROM users WHERE status='pending' ORDER BY created_at");
      return r.rows.map((row) => ({ id: row.id, username: row.username, createdAt: Number(row.created_at) }));
    },
    async deleteUser(id) {
      await db.query('DELETE FROM users WHERE id=$1', [id]);
      // Redis sessions can't be enumerated per user cheaply; /me returning 401
      // after deletion effectively logs the client out.
    },
    async getUserByName(username) {
      const r = await db.query('SELECT * FROM users WHERE username=$1', [username]);
      return rowUser(r.rows[0]);
    },
    async getUserById(id) {
      const r = await db.query('SELECT * FROM users WHERE id=$1', [id]);
      return rowUser(r.rows[0]);
    },

    // --- chats ---
    async createChat({ id, storage, createdAt, members }) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO chats (id, storage, created_at, last_ts) VALUES ($1,$2,$3,$3)', [id, storage, createdAt]);
        for (const m of members) {
          await client.query(
            'INSERT INTO chat_members (chat_id, user_id, wrapped_key, enc_name) VALUES ($1,$2,$3,$4)',
            [id, m.userId, m.wrappedKey, m.encName || null]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async getChat(chatId) {
      const r = await db.query('SELECT * FROM chats WHERE id=$1', [chatId]);
      if (!r.rows[0]) return null;
      const m = await db.query('SELECT user_id FROM chat_members WHERE chat_id=$1', [chatId]);
      const c = r.rows[0];
      return { id: c.id, storage: c.storage, createdAt: Number(c.created_at), lastTs: Number(c.last_ts), memberIds: m.rows.map((x) => x.user_id) };
    },
    async getMember(chatId, userId) {
      const r = await db.query('SELECT wrapped_key, enc_name FROM chat_members WHERE chat_id=$1 AND user_id=$2', [chatId, userId]);
      const row = r.rows[0];
      return row ? { wrappedKey: row.wrapped_key, encName: row.enc_name } : null;
    },
    async listChats(userId) {
      const r = await db.query(
        `SELECT c.id, c.storage, c.created_at, c.last_ts, me.wrapped_key, me.enc_name,
                u.id AS peer_id, u.username AS peer_username, u.pub_jwk AS peer_pub
         FROM chats c
         JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
         LEFT JOIN chat_members them ON them.chat_id = c.id AND them.user_id <> $1
         LEFT JOIN users u ON u.id = them.user_id
         ORDER BY c.last_ts DESC`,
        [userId]
      );
      return r.rows.map((row) => ({
        id: row.id, storage: row.storage, createdAt: Number(row.created_at), lastTs: Number(row.last_ts),
        wrappedKey: row.wrapped_key, encName: row.enc_name,
        peer: row.peer_id ? { id: row.peer_id, username: row.peer_username, pubJwk: row.peer_pub } : null,
      }));
    },
    async setChatName(chatId, userId, encName) {
      await db.query('UPDATE chat_members SET enc_name=$3 WHERE chat_id=$1 AND user_id=$2', [chatId, userId, encName]);
    },
    async touchChat(chatId, ts) {
      await db.query('UPDATE chats SET last_ts=$2 WHERE id=$1', [chatId, ts]);
    },

    // --- sessions (Redis: cleared when Redis pod restarts => re-login) ---
    async createSession(tok, userId) {
      await redis.set(`sess:${tok}`, userId, { EX: Math.floor(config.sessionTtlMs / 1000) });
    },
    async getSession(tok) {
      return await redis.get(`sess:${tok}`);
    },
    async deleteSession(tok) {
      await redis.del(`sess:${tok}`);
    },

    // --- login rate limiting ---
    async isLocked(username) {
      const ttl = await redis.pTTL(`lock:${username}`);
      return ttl > 0 ? Date.now() + ttl : null;
    },
    async authFail(username) {
      const count = await redis.incr(`af:${username}`);
      await redis.pExpire(`af:${username}`, config.lockoutMs);
      if (count >= config.maxLoginFails) {
        await redis.set(`lock:${username}`, '1', { PX: config.lockoutMs });
        await redis.del(`af:${username}`);
        return Date.now() + config.lockoutMs;
      }
      return null;
    },
    async authOk(username) {
      await redis.del(`af:${username}`, `lock:${username}`);
    },

    // --- non-persistent (RAM) chat data in Redis ---
    async npAddMsg(chatId, msg) {
      const ex = Math.ceil(config.retentionMs / 1000);
      await redis.set(`np:msg:${chatId}:${msg.id}`, JSON.stringify(msg), { EX: ex });
      await redis.zAdd(`np:idx:${chatId}`, [{ score: msg.ts, value: msg.id }]);
      await redis.expire(`np:idx:${chatId}`, ex);
    },
    async npListMsgs(chatId, limit = 500) {
      const ids = await redis.zRange(`np:idx:${chatId}`, -limit, -1);
      if (!ids.length) return [];
      const raw = await redis.mGet(ids.map((id) => `np:msg:${chatId}:${id}`));
      const out = [];
      for (let i = 0; i < ids.length; i++) {
        if (raw[i]) out.push(JSON.parse(raw[i]));
        else await redis.zRem(`np:idx:${chatId}`, ids[i]); // expired
      }
      return out;
    },
    async npGetMsg(chatId, msgId) {
      const raw = await redis.get(`np:msg:${chatId}:${msgId}`);
      return raw ? JSON.parse(raw) : null;
    },
    async npDelMsg(chatId, msgId) {
      const msg = await this.npGetMsg(chatId, msgId);
      if (!msg) return null;
      await redis.del(`np:msg:${chatId}:${msgId}`);
      await redis.zRem(`np:idx:${chatId}`, msgId);
      if (msg.file?.fileId) await this.npDelFile(chatId, msg.file.fileId);
      return msg;
    },
    // Incomplete uploads only reserve quota for 24h; completing re-extends to retainUntil.
    async npFileInit(chatId, fileId, meta) {
      const ex = Math.min(Math.ceil((meta.retainUntil - Date.now()) / 1000), 24 * 3600);
      await redis.set(`np:file:${fileId}`, JSON.stringify(meta), { EX: ex });
      await redis.zAdd(`np:files:${chatId}`, [{ score: Date.now(), value: fileId }]);
      await redis.expire(`np:files:${chatId}`, Math.ceil(config.retentionMs / 1000));
    },
    async npFilePutChunk(chatId, fileId, n, buf) {
      const meta = await this.npFileMeta(chatId, fileId);
      if (!meta) throw new Error('no-file');
      const ex = Math.max(60, Math.ceil((meta.retainUntil - Date.now()) / 1000));
      await redis.set(`np:file:${fileId}:c:${n}`, buf, { EX: ex });
    },
    async npFileMeta(chatId, fileId) {
      const raw = await redis.get(`np:file:${fileId}`);
      return raw ? JSON.parse(raw) : null;
    },
    async npFileSetMeta(chatId, fileId, meta) {
      let ex = Math.max(60, Math.ceil((meta.retainUntil - Date.now()) / 1000));
      if (!meta.complete) ex = Math.min(ex, 24 * 3600);
      await redis.set(`np:file:${fileId}`, JSON.stringify(meta), { EX: ex });
    },
    async npFileChunk(chatId, fileId, n) {
      return await redis.get(commandOptions({ returnBuffers: true }), `np:file:${fileId}:c:${n}`);
    },
    async npDelFile(chatId, fileId) {
      const meta = await this.npFileMeta(chatId, fileId);
      const keys = [`np:file:${fileId}`];
      if (meta) for (let i = 0; i < meta.chunks; i++) keys.push(`np:file:${fileId}:c:${i}`);
      await redis.del(keys);
      await redis.zRem(`np:files:${chatId}`, fileId);
    },
    async npUsage(chatId) {
      const ids = await redis.zRange(`np:files:${chatId}`, 0, -1);
      let total = 0;
      for (const fileId of ids) {
        const meta = await this.npFileMeta(chatId, fileId);
        if (meta) total += meta.size;
        else await redis.zRem(`np:files:${chatId}`, fileId);
      }
      return total;
    },

    // --- pubsub: fan events out to every api pod ---
    async publish(event) {
      await redis.publish(CHANNEL, JSON.stringify(event));
    },
    subscribe(fn) {
      sub.subscribe(CHANNEL, (raw) => {
        try { fn(JSON.parse(raw)); } catch { /* ignore */ }
      });
    },

    // Inactive-account cleanup. Returns removed chat ids for PVC purging.
    async sweepAccounts(nowTs) {
      const cutoff = nowTs - config.accountRetentionMs;
      const expired = await db.query(
        'SELECT id FROM users WHERE COALESCE(last_seen, created_at) < $1', [cutoff]
      );
      const removedChats = [];
      for (const { id: userId } of expired.rows) {
        const cs = await db.query('SELECT chat_id FROM chat_members WHERE user_id=$1', [userId]);
        for (const { chat_id: chatId } of cs.rows) {
          await db.query('DELETE FROM chats WHERE id=$1', [chatId]); // members cascade
          const msgIds = await redis.zRange(`np:idx:${chatId}`, 0, -1);
          const fileIds = await redis.zRange(`np:files:${chatId}`, 0, -1);
          for (const fileId of fileIds) await this.npDelFile(chatId, fileId);
          if (msgIds.length) await redis.del(msgIds.map((m) => `np:msg:${chatId}:${m}`));
          await redis.del([`np:idx:${chatId}`, `np:files:${chatId}`]);
          removedChats.push(chatId);
        }
        await db.query('DELETE FROM users WHERE id=$1', [userId]);
      }
      return removedChats;
    },

    // --- sweep: TTLs do the real work; prune index zsets ---
    async sweep(nowTs) {
      for await (const key of redis.scanIterator({ MATCH: 'np:idx:*', COUNT: 100 })) {
        await redis.zRemRangeByScore(key, 0, nowTs - config.retentionMs);
      }
    },
  };
}
