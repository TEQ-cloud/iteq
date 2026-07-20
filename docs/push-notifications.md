# Push notifications

Push notifications let iTEQ alert someone about a new message **while the app is
closed**. They are optional: without them, iTEQ still shows notifications while
the app is open, and everything else works normally.

Enabling push takes one thing: a **VAPID keypair** on the server.

---

## What is a VAPID keypair, and why do I need one?

Browsers don't receive pushes from your server directly. They receive them from
their vendor's push service — Apple for Safari/iOS, Google for Chrome/Android,
Mozilla for Firefox. Your server hands the message to that service, and the
service wakes the device.

Those services only accept messages from a server that can **prove it is the
same server the user subscribed to**. That proof is the VAPID keypair:

- The **public key** is handed to the browser when a user enables notifications.
  The browser ties its subscription to that key.
- The **private key** stays on your server and signs every push you send.

If the keys don't match, the push service rejects the message. That's why every
api pod must carry the *same* keypair — and why rotating it invalidates all
existing subscriptions (users simply tap 🔔 again).

### And the email address (`VAPID_SUBJECT`)?

The VAPID spec requires your server to identify itself with a contact URI —
`mailto:you@example.com` or `https://your-site`. It exists so the push service
operator (Apple, Google, Mozilla) can reach **you, the server operator**, if
your server misbehaves: malformed payloads, abusive volume, that kind of thing.
Nothing is sent to it in normal operation and users never see it.

> **Use a role address, not a personal one.** That address *is* visible to
> Apple and Google, because they validate the signature it's part of.
> `mailto:admin@yourdomain` — never a private mailbox.

---

## Step 1 — Generate the keypair

Run it once, from the api image (no install needed):

```bash
docker run --rm ghcr.io/teq-cloud/iteq-api:latest node src/vapid.js
```

Output:

```
VAPID_PUBLIC_KEY=BAzf9QVY5ZKCz-xhCU3v1WWsbMwh81h2H1Q69Wjgxv...
VAPID_PRIVATE_KEY=HWB7KVqm7nu6oYX2aymOmXw7QdVzGOXWDVshmbEo8Jw
VAPID_SUBJECT=mailto:you@example.com
```

Keep the private key secret — treat it like a password. Store it in your
password manager or secret store; if you lose it you can generate a new pair,
but everyone has to re-enable notifications.

## Step 2 — Configure the server

### Helm

```yaml
push:
  vapidPublicKey: "BAzf9QVY5ZKCz-xhCU3v1WWsbMwh81h2H1Q69Wjgxv..."
  vapidPrivateKey: "HWB7KVqm7nu6oYX2aymOmXw7QdVzGOXWDVshmbEo8Jw"
  vapidSubject: "mailto:admin@yourdomain"
```

```bash
helm upgrade iteq iteq/iteq -n iteq -f your-values.yaml
```

The chart writes the keys into a Kubernetes Secret for you. Prefer to manage the
Secret yourself? Create one with the keys `vapidPublicKey` and
`vapidPrivateKey`, then set `push.existingSecret: your-secret-name` and only
`push.vapidSubject` in values.

### Docker compose

In your `.env`:

```
VAPID_PUBLIC_KEY=BAzf9QVY5ZKCz-...
VAPID_PRIVATE_KEY=HWB7KVqm7nu6...
VAPID_SUBJECT=mailto:admin@yourdomain
```

```bash
docker compose up -d
```

### Raw Kubernetes manifests

```bash
kubectl -n iteq create secret generic iteq-push \
  --from-literal=vapidPublicKey='BAzf9QVY5...' \
  --from-literal=vapidPrivateKey='HWB7KVqm7...'
```

Set `VAPID_SUBJECT` in `k8s/40-api.yaml` (the secret references are already
there), then `kubectl apply -k k8s/`.

## Step 3 — Verify the server

```bash
curl https://your-host/api/push/vapid
```

```json
{"enabled":true,"publicKey":"BAzf9QVY5ZKCz-..."}
```

`"enabled": false` means the api didn't get the keys — check that both env vars
reached the pod (`kubectl -n iteq describe pod ...`) and that you restarted it.

## Step 4 — Enable it on each device

Every user does this once per device: open iTEQ, tap the **🔔** button in the
header, and allow notifications.

**On iPhone and iPad there is an extra rule from Apple:** notifications only
work if the app is installed on the Home Screen. In Safari, tap **Share** →
**Add to Home Screen**, open iTEQ from that icon, *then* tap 🔔. If you tap 🔔
before installing, the app tells you so instead of failing silently.

Android, Windows, macOS and Linux: no install needed, though installing is nice
anyway.

---

## What a notification actually contains

Nothing sensitive. The push says only *that* there's a new message and which
chat it belongs to — no sender, no text, no filenames.

That isn't a limitation we chose to add; it's a consequence of the design. The
server only ever holds ciphertext, so it has nothing else to put in the
notification. The payload is also encrypted end-to-end to the device, so
**Apple's and Google's push services can't read even the chat id.** The app
fills in the real content once you open it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `enabled: false` from `/api/push/vapid` | Keys didn't reach the api pod, or it wasn't restarted |
| Nothing happens on iPhone | The app isn't on the Home Screen (Apple's requirement) |
| 🔔 says "Notifications are blocked" | Permission was denied earlier — re-allow it in browser/system settings for the site |
| Worked before, stopped after redeploy | The keypair changed — everyone must tap 🔔 again |
| Works on desktop, not on phone | Check the phone's own notification settings for the installed app |

## Rotating or removing the keys

Generate a new pair and redeploy: old subscriptions stop working and users
re-enable them with 🔔. Removing the keys entirely disables background
notifications; in-app notifications keep working.
