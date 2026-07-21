# Changelog

## 0.3.3-beta — 2026-07-21

Fixes an api crash loop (`WRONGPASS`) introduced by the Redis password added in
0.3.1-beta. GitOps deployments are affected; plain `helm install`/`upgrade` is
not.

**What went wrong.** The chart generates the Redis password and preserves it
across upgrades by reading the existing Secret back out of the cluster. Argo CD
and Flux render with `helm template`, where that read returns nothing — so every
sync minted a *new* password. The Redis pod's spec never changed, so it kept
running with the original password, while the api pods (restarted by the
0.3.2-beta image bump) picked up the new one. Different passwords on the two
sides is exactly what `WRONGPASS` reports.

- **Both Deployments now carry a checksum of the password Secret**, so a
  password change rolls Redis and the api together instead of stranding them on
  different values. This is the actual defect: nothing made Redis re-read a
  changed password.
- **The api explains this failure instead of dumping a stack trace.** A
  credentials mismatch now prints what happened and the exact commands to fix
  it, then still exits (it genuinely cannot run without Redis). Credentials are
  verified at startup with a ping, so the "api has no password at all" variant
  (`NOAUTH`) is caught in the same place rather than surfacing later as an
  unhandled rejection.
- **`redis.auth.existingSecret` is now documented as required for GitOps**, in
  the chart NOTES, both READMEs and `env/prod-values.yaml` — pinning the Secret
  is what stops the password rotating on every sync.

**If you are hitting this now:**

```bash
kubectl -n iteq create secret generic iteq-redis-auth \
  --from-literal=redis-password="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n iteq rollout restart deploy/iteq-redis deploy/iteq-api
```

Then set `redis.auth.existingSecret: iteq-redis-auth` in your values so it stops
drifting. Sessions and non-persistent chats are cleared, which is inherent to
restarting Redis — it never persists them by design.

## 0.3.2-beta — 2026-07-20

Clears the last container CVEs. No code changes, no behaviour changes.

- **The api image no longer ships npm.** Every vulnerability the scanners
  flagged against it (`undici` ×4, `tar` ×1 — one HIGH, two MEDIUM, two LOW)
  came from npm's *own* bundled dependencies in the `node` base image, not from
  iTEQ's, which are express/pg/redis/web-push/ws and nothing else. The api runs
  `node src/index.js` and the retention job runs `node src/prune.js`, so npm
  and corepack were only ever build-time tooling. The image is now a two-stage
  build that installs dependencies in a builder and drops npm, corepack and
  yarn from the runtime layer. Verified with Trivy: **5 findings → 0**, with
  the web image also at 0.
- **VAPID keys are generated with `node src/vapid.js`** instead of
  `npm run vapid` (npm is gone). Docs, compose, chart and manifests updated.

## 0.3.1-beta — 2026-07-20

Security hardening release, from a full audit of the codebase plus the
Artifact Hub image scan. No user-visible changes to how chatting works.

**Fixed — access control**

- **Path traversal (`fileId`).** `POST /files/:fileId/complete` and
  `GET /files/:fileId/meta` didn't validate the id before it reached the
  filesystem. Express percent-decodes path params, so an encoded `../` escaped
  the chat's directory and could read any `*.meta.json` on the volume —
  including other chats'. Both endpoints now validate, and `complete` also
  checks the file belongs to the chat in the URL.
- **Push unsubscribe (IDOR).** `POST /push/unsubscribe` deleted by endpoint
  with no owner check, so any account could unsubscribe another account's
  device. Now scoped to the caller.
- **Push endpoint SSRF.** A subscription endpoint is a client-supplied URL the
  server then sends requests to. Restricted to the real push services
  (`PUSH_ENDPOINT_HOSTS` to extend, `PUSH_ALLOW_ANY_ENDPOINT=1` to disable),
  and capped at 10 devices per account.

**Fixed — auth**

- **Admin claim fails closed.** With `ADMIN_USERS` set but no usable
  `ADMIN_SETUP_CODE` (unset, under 8 characters, or a placeholder like
  `change-me`), the api now refuses to hand out the admin account instead of
  granting it to whoever registers first. Warns loudly at startup. The code is
  compared in constant time.
- **Username enumeration via timing.** A login for an unknown username returned
  without doing the scrypt work, so response time revealed which accounts
  exist. Unknown users now pay the same cost.
- **Rate limiting.** Per-ip limits on signup (5/hour) and login (60/hour), plus
  a ceiling on accounts waiting for approval (50) so a flood can't bury the
  approval panel. All tunable; a family instance will never reach them.
- **Sessions on WebSockets.** A socket authenticated once at connect and was
  never re-checked, so a logged-out tab kept receiving live events. The
  30-second heartbeat now re-validates and closes revoked sockets.
- Upload completeness is tracked per chunk index, so re-uploading one chunk
  can no longer satisfy the size check while leaving holes in the file.

**Added — hardening**

- **Content-Security-Policy** and the usual headers (frame-ancestors, nosniff,
  Referrer-Policy, Permissions-Policy, HSTS, COOP/CORP) on the web image.
- **Redis now requires a password**, generated at install by the chart and kept
  across upgrades (`redis.auth.existingSecret` for GitOps, where a
  `helm template` render can't preserve a generated one), and is restricted to
  the api pods by a **NetworkPolicy**.
- **Containers run hardened**: non-root, read-only root filesystem, all
  capabilities dropped, `seccompProfile: RuntimeDefault`. The web pod keeps a
  lighter set because stock nginx needs root to start.
- The api resolves the real client ip through `TRUST_PROXY_HOPS` (nginx now
  forwards `X-Forwarded-For`), which is what the per-ip limits key on.
- Base images bumped and `apk upgrade` added, clearing the OpenSSL/expat/
  libxml2/libpng/musl/zlib CVEs the Artifact Hub scan flagged.

**Documented**

- `SECURITY.md` now spells out concretely what a malicious operator can do —
  including that a 6-digit PIN is brute-forceable offline in hours and that
  public-key substitution would go undetected. Both are real limits with fixes
  on the roadmap, not things this release closes.

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
