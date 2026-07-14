import crypto from 'node:crypto';

export const uuid = () => crypto.randomUUID();
export const token = () => crypto.randomBytes(32).toString('hex');
export const now = () => Date.now();

// Filenames sort chronologically: zero-padded ms timestamp + id.
export const msgFileName = (ts, id) => `${String(ts).padStart(15, '0')}-${id}.json`;

export function scryptHash(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function scryptVerify(secret, stored) {
  try {
    const [v, saltHex, hashHex] = stored.split(':');
    if (v !== 's1') return false;
    const hash = crypto.scryptSync(secret, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

export const validUsername = (u) => typeof u === 'string' && /^[a-z0-9_-]{3,24}$/.test(u);
export const validId = (s) => typeof s === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(s);
