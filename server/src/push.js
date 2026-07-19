// Web Push (VAPID) — wakes a device when the app is closed.
//
// PRIVACY: the payload carries NO message content. The server physically can't
// read messages, so a push says only "which chat" — the app fills in the rest
// once it's open. Nothing sensitive passes through Apple's or Google's push
// services, which is exactly the point of this platform.
import webpush from 'web-push';
import { config } from './config.js';

export const pushEnabled = () => Boolean(config.vapidPublicKey && config.vapidPrivateKey);

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
