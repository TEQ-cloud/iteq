export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `http-${status}`);
    this.status = status;
    this.body = body || {};
  }
}

const token = () => localStorage.getItem('iteq.token');

async function request(method, path, body, raw) {
  const headers = {};
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let payload;
  if (raw) {
    headers['Content-Type'] = 'application/octet-stream';
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.headers.get('content-type')?.includes('octet-stream')) {
    if (!res.ok) throw new ApiError(res.status, null);
    return new Uint8Array(await res.arrayBuffer());
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export const api = {
  signup: (b) => request('POST', '/auth/signup', b),
  login: (b) => request('POST', '/auth/login', b),
  logout: () => request('POST', '/auth/logout', {}),
  me: () => request('GET', '/me'),
  vapidKey: () => request('GET', '/push/vapid'),
  pushSubscribe: (subscription) => request('POST', '/push/subscribe', { subscription }),
  pushUnsubscribe: (endpoint) => request('POST', '/push/unsubscribe', { endpoint }),
  adminPending: () => request('GET', '/admin/pending'),
  adminApprove: (id) => request('POST', `/admin/users/${id}/approve`, {}),
  adminReject: (id) => request('DELETE', `/admin/users/${id}`),
  lookupUser: (username) => request('GET', `/users/${username}`),
  myChats: () => request('GET', '/me/chats'),
  createChat: (b) => request('POST', '/chats', b),
  renameChat: (chatId, encName) => request('PATCH', `/chats/${chatId}/name`, { encName }),
  messages: (chatId) => request('GET', `/chats/${chatId}/messages`),
  sendMessage: (chatId, b) => request('POST', `/chats/${chatId}/messages`, b),
  deleteMessage: (chatId, msgId) => request('DELETE', `/chats/${chatId}/messages/${msgId}`),
  sendReceipt: (chatId, payload) => request('POST', `/chats/${chatId}/receipt`, { payload }),
  receipts: (chatId) => request('GET', `/chats/${chatId}/receipts`),
  fileInit: (chatId, b) => request('POST', `/chats/${chatId}/files/init`, b),
  filePutChunk: (chatId, fileId, n, bytes) => request('PUT', `/chats/${chatId}/files/${fileId}/chunks/${n}`, bytes, true),
  fileComplete: (chatId, fileId) => request('POST', `/chats/${chatId}/files/${fileId}/complete`, {}),
  fileChunk: (chatId, fileId, n) => request('GET', `/chats/${chatId}/files/${fileId}/chunks/${n}`),
};
