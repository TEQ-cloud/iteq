# iTEQ — stay interconnected

Self-hosted, end-to-end encrypted chat for friends and family (the **i** stands for
*interconnected*). Runs on Kubernetes at https://i.teqcloud.net/, works in any modern
browser on iOS, Android, PC and Mac (installable as a PWA via "Add to Home Screen").

Built to keep private conversations private: the server only ever sees ciphertext,
made-up usernames, UUIDs, timestamps and sizes. No search, no directory, no read
receipts, no history hoarding — chat content is deleted after 7 days at most.
Chat *definitions* (who a chat is with, its encrypted name, its keys) are metadata
like accounts: they persist regardless of a chat's storage mode.

**iTEQ is a closed service.** Every new account lands in `pending` until an admin
(username listed in `ADMIN_USERS`) approves it in-app. This is deliberate positioning:
a private, non-commercial, invitation-style circle of friends and family — trust,
not a promise, as the onboarding disclaimer spells out. (Note: a disclaimer cannot
waive statutory law; staying closed and non-commercial is what keeps this out of
"service offered to the public" territory. Not legal advice.)

## Repo layout

```
server/          Node.js api (the only stateful logic; builds the api image)
web/             React PWA (builds the web/nginx image)
k8s/             raw manifests (kustomize) — what the TEQcloud instance runs
charts/iteq/     Helm chart (same manifests, parameterised via values.yaml)
deploy/compose/  docker-compose + Caddy (auto-HTTPS) for non-k8s hosting
examples/        real-world extras: CNPG cluster, Argo ApplicationSet, ...
```

One repo on purpose: source, chart and deploy examples version together, so a
release is one tag → two images → chart bump. Images are built and published
only by TEQcloud; self-hosters consume the images + chart/compose and override
parameters (they never need to build).

## Admins (`ADMIN_USERS`)

The `ADMIN_USERS` env var on the api decides who runs the place. It is a
comma-separated list of usernames (spaces around commas are fine):

```yaml
- name: ADMIN_USERS
  value: "quinten, backup-admin"
```

Accounts whose username is in the list are **auto-approved at signup** and get
the in-app 👥 approval panel. Everyone else waits in `pending`. To change it:
edit `k8s/40-api.yaml` (or the `adminUsers` Helm value / `ADMIN_USERS` in the
compose `.env`) and roll out — it's read at startup, not stored in the
database, so promoting or demoting an admin is just a config change. The
username must match an account exactly; create the account after (or before)
adding it to the list, order doesn't matter.

**Important:** `ADMIN_USERS` reserves a *username* — the server never stores an
admin PIN. The account only exists once someone signs up with that username and
picks their own PIN. On a public deployment that's a race: whoever registers the
admin username first becomes admin. So set **`ADMIN_SETUP_CODE`** (env / Helm
value `adminSetupCode` / compose `.env`): claiming an admin username at signup
then requires that code — the UI asks for it automatically. Regular signups are
unaffected. There are no other secrets to provision: CNPG generates the database
credentials itself (`<cluster>-app` secret), unless you bring your own — see
[examples/cnpg.yaml](examples/cnpg.yaml).

## Architecture

```
                       ┌──────────────────────────── Kubernetes ───────────────────────────┐
 browser (PWA)         │  Ingress (TLS, required for WebCrypto)                            │
 ─ WebCrypto E2EE      │    ├── /            → iteq-web  (nginx, static, HPA 2–4)          │
 ─ keys in IndexedDB   │    └── /api, /ws    → iteq-api  (Node.js, stateless, HPA 2–6)     │
                       │                          │            │            │              │
                       │            CNPG Postgres │      Redis (no persist) │  PVC RWX 100Gi
                       │            accounts/chat │      sessions, pubsub,  │  persistent   │
                       │            metadata only │      RAM chats + files  │  chats+files  │
                       └───────────────────────────────────────────────────────────────────┘
```

- **Postgres (CNPG)** — account + chat *metadata* only: username, UUID, scrypt-hashed
  login key, PIN-encrypted private key, public key, wrapped chat keys, encrypted
  friendly names. Never message content.
- **Redis (persistence disabled)** — the "non-persistent" storage tier. RAM-chat
  messages and files, sessions, rate limits and cross-pod pubsub live purely in
  memory and die with the Redis pod, exactly as promised in the UI.
- **PVC (RWX, 100Gi)** — the "persistent" tier. Every message/file is its own file
  (`/data/chats/<chatId>/{msg,files}/…`), so all api pods share it without locking.
  The PVC can run past 100Gi if the storage class allows it; extend when needed.

## Encryption (what the server can and cannot see)

- PIN + username → PBKDF2 (600k iters) → an **auth key** (sent to the server, scrypt-hashed
  there) and a **wrap key** (never leaves the browser).
- Each account has an ECDH P-256 keypair. The private key is stored server-side only
  in PIN-encrypted form → log in from any device, server still can't read it.
- Each chat has a random AES-256-GCM key, wrapped per member via ECDH+HKDF.
  Messages, file chunks (8 MiB each) and friendly chat names are AES-GCM ciphertext
  before they leave the device.
- **Honest limits:** no forward secrecy (one key per chat); a 6-digit PIN can be
  brute-forced by someone with server access and patience — the operator "technically
  could", which is exactly what the onboarding disclaimer tells every user. Lost PIN
  = lost account; there is no recovery, by design.

## Storage rules (enforced server-side, explained in the UI)

| | Non-persistent (default) | Persistent |
|---|---|---|
| Where | RAM (Redis) | SSD (PVC) |
| Survives restart/reschedule | No — gone, try again | Yes |
| Retention | 7 days (may be less) | 7 days |
| Max file | 1 GB | unlimited* |
| Max per chat | 2 GB | unlimited* |

\* Files over 1 GB **require** a persistent chat. Files over 5 GB trigger a warning
(success not guaranteed) and keep only **3 days**. Abandoned uploads are cleared
after 24 h. Deleting a message deletes it for everyone (there is only one copy).

**Accounts** unused for 6 months (`ACCOUNT_RETENTION_DAYS`, default 180) are
deleted automatically, their chats included — the inactivity clock resets on
every login/app-open. Configurable via env / Helm value, but note the UI texts
state the defaults.

## Local development

```bash
cd server && npm install && npm run dev     # in-memory server on :8080
cd web && npm install && npm run dev        # vite on :5173, proxies /api + /ws
```

Or build the web app (`npm run build`) and the dev server serves it on :8080 directly.

## Deploy

Cluster prerequisites: CNPG operator, an RWX-capable storage class, an ingress
controller (nginx), **metrics-server** (the HPAs need it), and TLS — **without
HTTPS, browsers refuse to expose WebCrypto and the app cannot run.**

1. Build and push the images (any registry your cluster can pull from):
   ```bash
   docker build -t <registry>/iteq/api:0.1.0-beta server/ && docker push <registry>/iteq/api:0.1.0-beta
   docker build -t <registry>/iteq/web:0.1.0-beta web/   && docker push <registry>/iteq/web:0.1.0-beta
   ```
2. Edit `k8s/`: image names (`40-api.yaml`, `50-web.yaml`, `70-retention-cronjob.yaml`),
   `ADMIN_USERS` (`40-api.yaml`), storage classes (`10-postgres.yaml`, `30-pvc.yaml`),
   Redis `maxmemory` (`20-redis.yaml`). The ingress is already set to `i.teqcloud.net`.
3. DNS: point `i.teqcloud.net` at your ingress. TLS: either uncomment the cert-manager
   annotation in `60-ingress.yaml` or create the `iteq-tls` secret yourself.
4. `kubectl apply -k k8s/`, then watch it come up:
   ```bash
   kubectl -n iteq get pods -w
   kubectl -n iteq rollout status deploy/iteq-api
   ```
5. Open the site, create the `quinten` account (auto-approved: it's in `ADMIN_USERS`).
   Everyone else who signs up waits in the 👥 panel until you approve them.

### Rolling updates (DevOps-style)

Both Deployments use `RollingUpdate` with `maxUnavailable: 0` — a new version must be
ready before an old pod is killed, so deploys are zero-downtime:

```bash
docker build -t <registry>/iteq/api:1.0.1-beta server/ && docker push <registry>/iteq/api:1.0.1-beta
kubectl -n iteq set image deploy/iteq-api api=<registry>/iteq/api:1.0.1-beta
kubectl -n iteq rollout status deploy/iteq-api    # live view of the rollout
kubectl -n iteq rollout undo deploy/iteq-api      # instant rollback if needed
```

The api reports its running version, so you can always check what's live:
`curl https://i.teqcloud.net/api/healthz` → `{"ok":true,"version":"1.0.1-beta"}`.
During the beta, drop the iOS "Add to Home Screen" screenshot in as
`web/public/tour-ios.png` and rebuild the web image — the in-app tour picks it up
automatically.

`MODE=dev` runs everything in-process/in-memory with `server/data/` as the "PVC" —
no Postgres or Redis needed.

### Helm instead of raw manifests

```bash
helm install iteq charts/iteq -n iteq --create-namespace \
  --set image.api.repository=<registry>/iteq/api \
  --set image.web.repository=<registry>/iteq/web \
  --set adminUsers=quinten \
  --set ingress.host=i.teqcloud.net
# upgrades: helm upgrade iteq charts/iteq -n iteq -f my-values.yaml
```

All knobs live in [charts/iteq/values.yaml](charts/iteq/values.yaml) — retention
days, quotas, HPA ranges, CNPG on/off (bring your own Postgres via
`postgres.existingUriSecret`), Redis size, cert-manager issuer.

### Docker compose (no Kubernetes)

See [deploy/compose](deploy/compose): `cp .env.example .env`, fill in domain +
password + admins, `docker compose up -d`. Caddy fetches TLS certificates
automatically, which satisfies the hard HTTPS requirement.

### Recommended workflow: dev instance next to prod

Test changes on a **second release in its own namespace** rather than on the
live instance your family uses — same images, same chart, different host:

```bash
helm install iteq-dev charts/iteq -n iteq-dev --create-namespace \
  -f dev-values.yaml   # e.g. host=dev.i.teqcloud.net, 1 replica, small PVC
```

Promote by rolling the exact image tag you validated on dev to prod. That's the
DevOps loop: identical environments, promote artifacts — without your users
eating your experiments. (The npm dev mode stays useful for fast UI iteration;
seconds instead of build-push-rollout minutes.)

## Operations notes

- **Sessions** live in Redis: restarting Redis logs everyone out (as documented in the UI).
- **Retention** is enforced three ways: Redis TTLs, a 10-minute in-process sweep in every
  api pod, and the daily `iteq-retention` CronJob for the PVC.
- **Troubleshooting etiquette** (the promise made to users): if you need to touch
  chat data on the server, contact affected users first. Account rows in Postgres
  (usernames/keys) are not covered by that promise — chat data is.
- Messages over the wire and at rest are ciphertext; if you must debug, sizes,
  timestamps and UUIDs are all you'll get. That's the point.
