# Changelog

## 0.3.0-beta — 2026-07-19

Optional read receipts.

- **Added: read receipts** — your sent messages show ✓ (on the server) and
  ✓✓ (read), like you'd expect from a chat app.
- **Optional, both ways:** a switch in the new ⚙ Settings turns them off —
  you then stop *sending* receipts and stop *seeing* them.
- **E2E encrypted like everything else.** The receipt is a ciphertext blob;
  the server relays and stores it without ever learning which message was
  read. Receipts don't trigger push notifications and follow the chat's
  storage mode (RAM receipts die with the Redis pod, persistent ones live on
  the PVC and are swept with the 7-day retention).
- Fixed: the BETA badge in the roadmap now matches the project site's style
  (the bordered chip didn't fit the version column).

## 0.2.0-beta — 2026-07-17

Push notifications.

- **Fixed: notifications never appeared on iPhone/iPad.** The app used the
  `Notification` constructor, which iOS does not implement at all — not even in
  an installed PWA. The permission prompt appeared, then nothing ever showed.
  All notifications now go through the service worker
  (`registration.showNotification`), which works on every platform.
- **Added: Web Push** — notifications arrive while the app is closed. Requires a
  VAPID keypair on the server (`npm run vapid`, then the `push.*` Helm values or
  `VAPID_*` env). Without keys, push is simply off and in-app alerts still work.
  - iOS/iPadOS: the app must be added to the Home Screen first (Apple's rule).
    The 🔔 button now explains that instead of failing silently.
  - Tapping a notification opens the right chat.
- **Push payloads carry no message content.** The server cannot read messages,
  so a push says only which chat — and even that is encrypted end-to-end to the
  device, so Apple's and Google's push services see nothing.
- Subscriptions are stored per device and pruned automatically when a browser
  drops them.

## 0.1.2-beta — 2026-07-16

iOS fixes:

- Installed-app (standalone) mode: header, sidebar footer and composer now
  respect the safe areas — no more content behind the Dynamic Island, status
  bar, home indicator or screen corner radius.
- No more stuck zoom: inputs are ≥16px on phones (Safari auto-zoomed on focus
  and left ~10% of the page off-screen), pinch/double-tap zoom disabled,
  horizontal panning clamped. Header and footer stay fixed; only the message
  window scrolls.
- The in-app tour now ships the real iOS "Add to Home Screen" screenshot.

Known notice (no chart change): on a first install, api pods may restart a few
times while the CNPG database initializes — normal Kubernetes startup order,
settles by itself within a few minutes.

## 0.1.1-beta — 2026-07-16

- Landing page is now operator-neutral: instances no longer hardcode the
  TEQcloud/operator identity, and "Host yourself" points at the project page.
- First test of the tag-driven release flow end to end.

## 0.1.0-beta — 2026-07-16

First public release. 🎉

- End-to-end encrypted 1-on-1 chat (WebCrypto in the browser: PBKDF2 → ECDH
  P-256 → per-chat AES-256-GCM; the server only ever stores ciphertext)
- Per-chat storage choice: non-persistent (RAM/Redis) or persistent (SSD/PVC)
- 7-day content retention everywhere; 3 days for files over 5 GB; 1 GB/file and
  2 GB/chat limits on RAM chats; abandoned uploads cleared after 24 h
- Reply, forward, copy, delete (for everyone); encrypted friendly chat names
- File transfer with chunked client-side encryption, image & video previews,
  "uploaded" indicator
- Installable PWA (iOS/Android/desktop) with in-app tour; in-tab notifications
- Closed service: approval-gated accounts, `ADMIN_USERS` + `ADMIN_SETUP_CODE`
- Accounts unused for 6 months are removed automatically
- Deploy: Helm chart (any ingress class, tailscale/cloudflared-friendly web
  entrypoint), raw kustomize manifests, docker compose + Caddy
- Multi-arch images (amd64 + arm64) on GHCR

[Roadmap](https://github.com/TEQ-cloud/iteq#readme): v0.2.0 web push
notifications & optional read receipts · v0.3.0 group chats · v1.0.0 GA.
