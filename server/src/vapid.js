// One-shot VAPID keypair generator: `npm run vapid`
// Put the output in a Secret and set both values on every api pod.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`
VAPID keypair generated. Set these on the api (same values on every pod):

  VAPID_PUBLIC_KEY=${publicKey}
  VAPID_PRIVATE_KEY=${privateKey}
  VAPID_SUBJECT=mailto:you@example.com

Helm:  --set push.vapidPublicKey=... --set push.vapidPrivateKey=...
Keep the private key secret. Rotating it invalidates every existing
subscription (users just re-enable notifications).
`);
