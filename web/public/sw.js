// Service worker: "install as app", plus Web Push notifications.
// Network-first — chat data is never cached; only the app shell falls back to
// cache when offline.
const SHELL = 'iteq-shell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// --- notifications -----------------------------------------------------
// showNotification() is the ONLY way that works everywhere: iOS has no
// Notification constructor at all, even in an installed PWA.

// The page asks the worker to show in-app notifications too, so there is one
// code path on every platform.
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d?.type === 'notify') {
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: '/app-icon-192.png',
      badge: '/app-icon-192.png',
      tag: d.chatId,       // a newer message replaces the older bubble
      data: { chatId: d.chatId },
    });
  }
});

// Push payloads never contain message content — the server cannot read it.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* keep the generic text */ }
  e.waitUntil((async () => {
    // If a window is already visible, the app itself handles the notification.
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientList.some((c) => c.visibilityState === 'visible')) return;
    await self.registration.showNotification('iTEQ', {
      body: 'New message',
      icon: '/app-icon-192.png',
      badge: '/app-icon-192.png',
      tag: data.chatId || 'iteq',
      data: { chatId: data.chatId || null },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const chatId = e.notification.data?.chatId || null;
  e.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientList) {
      if ('focus' in c) {
        await c.focus();
        c.postMessage({ type: 'open-chat', chatId });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(chatId ? `/?chat=${chatId}` : '/');
  })());
});
