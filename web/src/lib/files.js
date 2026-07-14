// Chunked, client-side-encrypted file transfer.
// Plaintext is sliced into 8 MiB chunks; each chunk is AES-GCM encrypted with
// the chat key before upload, so the server only ever stores ciphertext.
import { api } from './api.js';
import { encryptBytes, decryptBytes, encryptJson, decryptJson, ENC_OVERHEAD } from './crypto.js';

export const CHUNK = 8 * 1024 * 1024;
export const GiB = 1024 * 1024 * 1024;

export const encryptedSizeOf = (file) => {
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK));
  return file.size + chunks * ENC_OVERHEAD;
};

export async function uploadFile(chatId, file, chatKey, onProgress) {
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK));
  const encChunkSize = CHUNK + ENC_OVERHEAD;
  const size = encryptedSizeOf(file);
  const encMeta = await encryptJson(chatKey, { name: file.name, type: file.type || 'application/octet-stream', size: file.size });

  const init = await api.fileInit(chatId, { size, chunks, encChunkSize, encMeta });
  for (let n = 0; n < chunks; n++) {
    const slice = file.slice(n * CHUNK, Math.min(file.size, (n + 1) * CHUNK));
    const plain = await slice.arrayBuffer();
    const enc = await encryptBytes(chatKey, plain);
    await api.filePutChunk(chatId, init.fileId, n, enc);
    onProgress?.((n + 1) / chunks);
  }
  const done = await api.fileComplete(chatId, init.fileId);
  return { fileId: init.fileId, big: done.big, retainUntil: done.retainUntil, uploadedAt: done.uploadedAt };
}

export async function downloadFile(chatId, fileRef, chatKey, onProgress) {
  const meta = await decryptJson(chatKey, fileRef.encMeta);
  const parts = [];
  for (let n = 0; n < fileRef.chunks; n++) {
    const enc = await api.fileChunk(chatId, fileRef.fileId, n);
    const plain = await decryptBytes(chatKey, enc);
    parts.push(plain); // Blob assembly lets the browser spill big files to disk
    onProgress?.((n + 1) / fileRef.chunks);
  }
  return { blob: new Blob(parts, { type: meta.type }), meta };
}

export async function fileMetaOf(fileRef, chatKey) {
  return decryptJson(chatKey, fileRef.encMeta);
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
