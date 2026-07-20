// Web Push (VAPID) — wakes a device when the app is closed.
//
// PRIVACY: the payload carries NO message content. The server physically can't
// read messages, so a push says only "which chat" — the app fills in the rest
// once it's open. Nothing sensitive passes through Apple's or Google's push
// services, which is exactly the point of this platform.
import webpush from 'web-push';
import { config } from './config.js';

export const pushEnabled = () => Boolean(config.vapidPublicKey && config.vapidPrivateKey);

// A subscription endpoint is a URL supplied by a client that the server then
// sends requests to — i.e. a request-forgery primitive if left open. Only the
// real push services are accepted, so a crafted subscription can't point the
// api at something on the internal network.
export function validPushEndpoint(endpoint) {
  if (config.pushAllowAnyEndpoint) return true;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return config.pushEndpointHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

if (pushEnabled()) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
}

// Fire-and-forget: a failing push must never break sending a message.
export async function pushToUsers(store, userIds, payload) {
  if (!pushEnabled() || !userIds?.length) return;
  const body = JSON.stringify(payload);
  for (const userId of userIds) {
    let subs = [];
    try {
      subs = await store.listPushSubs(userId);
    } catch (e) {
      console.error('push: listing subscriptions failed:', e.message);
      continue;
    }
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, body, { TTL: 24 * 60 * 60 });
      } catch (e) {
        // 404/410 = the browser dropped this subscription for good.
        if (e.statusCode === 404 || e.statusCode === 410) {
          await store.delPushSub(sub.endpoint).catch(() => {});
        } else {
          console.error('push: send failed:', e.statusCode || e.message);
        }
      }
    }
  }
}
