# Changelog

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
