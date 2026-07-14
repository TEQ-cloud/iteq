// All end-to-end encryption happens here, in the browser, with WebCrypto.
//
//   PIN + username --PBKDF2(600k)--> 512 bits --> [authKey | wrapKey]
//     authKey  -> sent to the server as the login secret (server scrypt-hashes it;
//                 it can't be turned back into the wrapKey)
//     wrapKey  -> AES-GCM key that encrypts your ECDH private key; NEVER leaves
//                 the browser. The server stores only the encrypted private key,
//                 which is what makes multi-device login possible without the
//                 server being able to read anything.
//
//   Each chat has a random AES-256-GCM key. It is wrapped for each member with
//   a KEK derived from ECDH(my private key, peer public key) + HKDF. Messages,
//   friendly chat names and file chunks are all AES-GCM ciphertext under the
//   chat key before they leave the device.
//
// NOTE: WebCrypto is only available in secure contexts — HTTPS (or localhost).

const te = new TextEncoder();
const td = new TextDecoder();

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// --- identity ---

export async function deriveFromPin(username, pin) {
  // Deterministic per-username salt so login needs no server round-trip first.
  const salt = await crypto.subtle.digest('SHA-256', te.encode(`iteq-v1|${username}`));
  const material = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 }, material, 512
  ));
  const authKey = hex(bits.slice(0, 32));
  const wrapKey = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { authKey, wrapKey };
}

export async function generateIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, pubJwk };
}

export async function wrapPrivateKey(privateKey, wrapKey) {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8);
  return { iv: b64(iv), ct: b64(ct) };
}

export async function unwrapPrivateKey(encPriv, wrapKey) {
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(encPriv.iv) }, wrapKey, unb64(encPriv.ct));
  // Import non-extractable: even this tab can't export the key afterwards.
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

// --- per-chat keys ---

async function kekFor(privateKey, peerPubJwk) {
  const peerPub = await crypto.subtle.importKey('jwk', peerPubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPub }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('iteq-chat-wrap-v1') },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function generateChatKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapChatKey(chatKey, privateKey, peerPubJwk) {
  const kek = await kekFor(privateKey, peerPubJwk);
  const raw = await crypto.subtle.exportKey('raw', chatKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: b64(iv), ct: b64(ct) };
}

export async function unwrapChatKey(wrapped, privateKey, peerPubJwk) {
  const kek = await kekFor(privateKey, peerPubJwk);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrapped.iv) }, kek, unb64(wrapped.ct));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// --- payloads ---

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJson(key, blob) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(td.decode(pt));
}

// File chunks: [ 12-byte IV | ciphertext+tag ] — 28 bytes overhead per chunk.
export const ENC_OVERHEAD = 28;

export async function encryptBytes(key, buf) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, key, u8.subarray(12));
}
