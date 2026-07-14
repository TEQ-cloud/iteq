// Persistent chat storage on the shared PVC (RWX). Every message and file is its
// own file with a unique name, so multiple api pods can read/write the same
// directories without locking.
//
// Layout:
//   <dataDir>/chats/<chatId>/msg/<paddedTs>-<msgId>.json
//   <dataDir>/chats/<chatId>/files/<fileId>.meta.json
//   <dataDir>/chats/<chatId>/files/<fileId>.bin
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { msgFileName } from './util.js';

const chatDir = (chatId) => path.join(config.dataDir, 'chats', chatId);
const msgDir = (chatId) => path.join(chatDir(chatId), 'msg');
const fileDir = (chatId) => path.join(chatDir(chatId), 'files');

async function ensure(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

export const pstore = {
  async addMsg(chatId, msg) {
    await ensure(msgDir(chatId));
    const file = path.join(msgDir(chatId), msgFileName(msg.ts, msg.id));
    await fsp.writeFile(file, JSON.stringify(msg));
  },

  async listMsgs(chatId, limit = 500) {
    let names;
    try {
      names = await fsp.readdir(msgDir(chatId));
    } catch {
      return [];
    }
    names.sort(); // padded-timestamp prefix => chronological
    const slice = names.slice(-limit);
    const out = [];
    for (const n of slice) {
      try {
        out.push(JSON.parse(await fsp.readFile(path.join(msgDir(chatId), n), 'utf8')));
      } catch { /* concurrently deleted */ }
    }
    return out;
  },

  async getMsg(chatId, msgId) {
    let names;
    try {
      names = await fsp.readdir(msgDir(chatId));
    } catch {
      return null;
    }
    const n = names.find((f) => f.endsWith(`-${msgId}.json`));
    if (!n) return null;
    try {
      return JSON.parse(await fsp.readFile(path.join(msgDir(chatId), n), 'utf8'));
    } catch {
      return null;
    }
  },

  async delMsg(chatId, msgId) {
    const msg = await this.getMsg(chatId, msgId);
    if (!msg) return null;
    await fsp.rm(path.join(msgDir(chatId), msgFileName(msg.ts, msg.id)), { force: true });
    if (msg.file?.fileId) await this.delFile(chatId, msg.file.fileId);
    return msg;
  },

  async fileInit(chatId, fileId, meta) {
    await ensure(fileDir(chatId));
    await fsp.writeFile(path.join(fileDir(chatId), `${fileId}.meta.json`), JSON.stringify(meta));
    await fsp.writeFile(path.join(fileDir(chatId), `${fileId}.bin`), Buffer.alloc(0));
  },

  // Positional write: chunk n always lands at n * encChunkSize, so sequential
  // PUTs are safe even if the Service routes them to different pods on NFS.
  async filePutChunk(chatId, fileId, n, buf, offset) {
    const bin = path.join(fileDir(chatId), `${fileId}.bin`);
    const fh = await fsp.open(bin, 'r+');
    try {
      await fh.write(buf, 0, buf.length, offset);
    } finally {
      await fh.close();
    }
  },

  async fileMeta(chatId, fileId) {
    try {
      return JSON.parse(await fsp.readFile(path.join(fileDir(chatId), `${fileId}.meta.json`), 'utf8'));
    } catch {
      return null;
    }
  },

  async fileSetMeta(chatId, fileId, meta) {
    await fsp.writeFile(path.join(fileDir(chatId), `${fileId}.meta.json`), JSON.stringify(meta));
  },

  fileChunkStream(chatId, fileId, start, end) {
    return fs.createReadStream(path.join(fileDir(chatId), `${fileId}.bin`), { start, end: end - 1 });
  },

  async delFile(chatId, fileId) {
    await fsp.rm(path.join(fileDir(chatId), `${fileId}.bin`), { force: true });
    await fsp.rm(path.join(fileDir(chatId), `${fileId}.meta.json`), { force: true });
  },

  // Retention sweep: messages past retainUntil, files past retainUntil.
  async sweep(nowTs) {
    let chats;
    try {
      chats = await fsp.readdir(path.join(config.dataDir, 'chats'));
    } catch {
      return;
    }
    for (const chatId of chats) {
      let names = [];
      try { names = await fsp.readdir(msgDir(chatId)); } catch { /* none */ }
      for (const n of names) {
        const ts = Number(n.slice(0, 15));
        if (nowTs - ts > config.retentionMs) {
          try {
            const msg = JSON.parse(await fsp.readFile(path.join(msgDir(chatId), n), 'utf8'));
            if (msg.file?.fileId) await this.delFile(chatId, msg.file.fileId);
          } catch { /* ignore */ }
          await fsp.rm(path.join(msgDir(chatId), n), { force: true });
        }
      }
      let metas = [];
      try { metas = (await fsp.readdir(fileDir(chatId))).filter((f) => f.endsWith('.meta.json')); } catch { /* none */ }
      for (const m of metas) {
        try {
          const meta = JSON.parse(await fsp.readFile(path.join(fileDir(chatId), m), 'utf8'));
          if (meta.retainUntil && nowTs > meta.retainUntil) {
            await this.delFile(chatId, meta.fileId);
          } else if (!meta.complete && nowTs - meta.createdAt > 24 * 3600 * 1000) {
            await this.delFile(chatId, meta.fileId); // abandoned upload
          }
        } catch { /* ignore */ }
      }
    }
  },
};
