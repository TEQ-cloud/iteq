// Notifications, the way every platform actually supports them.
//
// iOS has NO Notification constructor — not in Safari, not in an installed
// PWA. The only portable path is ServiceWorkerRegistration.showNotification(),
// so both in-app alerts and background pushes go through the worker.
import { api } from './api.js';

const urlB64ToUint8Array = (b64) => {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

export const notificationsSupported = () =>
  'serviceWorker' in navigator && 'Notification' in window;

// iOS only allows notifications once the app is on the home screen.
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const permission = () => (notificationsSupported() ? Notification.permission : 'unsupported');

// Show an alert while the app is open — via the worker, so iOS works too.
export async function showLocal({ title, body, chatId }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: 'notify', title, body, chatId });
}

// Ask permission and register for background push. Returns a status string.
export async function enableNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install'; // iOS: home screen first

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm; // 'denied' | 'default'

  // Background push is optional: without VAPID keys the server just says no,
  // and in-app notifications keep working.
  try {
    const { enabled, publicKey } = await api.vapidKey();
    if (!enabled || !publicKey) return 'granted-local';
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(publicKey),
    });
    await api.pushSubscribe(sub.toJSON());
    return 'granted-push';
  } catch (e) {
    console.warn('push subscription failed:', e);
    return 'granted-local';
  }
}

export async function disableNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* nothing to clean up */ }
}
