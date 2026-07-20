# iTEQ — stay interconnected

Self-hosted, **end-to-end encrypted** chat for friends and family, as a Helm
chart. The *i* stands for *interconnected*. Built by
[TEQcloud](https://github.com/TEQ-cloud/iteq) to get private conversations out
of big-tech clouds and away from scanning laws — messages, files and even chat
names are ciphertext before they leave the browser; the server stores made-up
usernames, UUIDs, timestamps and sizes. Nothing else.

**Closed by design:** every new account waits until an admin approves it in-app.
That keeps your deployment a private circle, not a public service.

## Prerequisites

- An ingress controller (nginx) and **TLS** — not optional: browsers only expose
  WebCrypto (the E2EE API) on HTTPS origins, so without a certificate the app
  cannot run. Use cert-manager (`ingress.certManagerClusterIssuer`) or bring
  your own secret.
- An **RWX-capable StorageClass** (NFS, CephFS, Longhorn …) for the persistent
  chat volume.
- The [CloudNativePG](https://cloudnative-pg.io/) operator — or set
  `postgres.cnpg.enabled=false` and bring your own Postgres via
  `postgres.existingUriSecret`.
- metrics-server if you keep the HPAs enabled.

## Install

Put your overrides in one values file (see [env/prod-values.yaml](env/prod-values.yaml)
for the pattern — the same file works for plain Helm and for Argo CD):

```bash
helm repo add iteq https://teq-cloud.github.io/iteq
helm install iteq iteq/iteq -n iteq --create-namespace -f my-values.yaml
```

Minimal `my-values.yaml`:

```yaml
ingress:
  host: chat.example.com
adminUsers: "yourname"
adminSetupCode: "pick-a-code"
storage:
  className: your-rwx-class
```

Then open your host, sign up with the admin username + the setup code (asked
automatically) — that account is auto-approved and approves everyone else from
the in-app 👥 panel.

> **First boot:** the api pods start before the CNPG database is ready and may
> restart a few times (`CrashLoopBackOff`) during the first minutes — with
> Argo CD the app can briefly show *Degraded* for the same reason. This is
> normal Kubernetes startup ordering; it settles by itself once Postgres is up.

## Push notifications (optional)

Generate a VAPID keypair once and pass it to the chart:

```bash
docker run --rm ghcr.io/teq-cloud/iteq-api:0.3.2-beta node src/vapid.js
```

```yaml
push:
  vapidPublicKey: "B..."
  vapidPrivateKey: "..."
  vapidSubject: "mailto:you@example.com"
```

Without keys, push is off and in-app notifications still work. On iOS/iPadOS
users must add iTEQ to the Home Screen before notifications can be enabled —
the app explains this when they tap 🔔. Push payloads contain no message
content (the server has none), so Apple's and Google's push services learn
nothing.

## Any edge you like

The web service is a **complete entrypoint**: its nginx serves the app and
proxies `/api` + `/ws` to the api service. So every exposure style works:

- **Ingress, any class** — set `ingress.className` (nginx gets its helper
  annotations automatically; for others add equivalents yourself):
  ```yaml
  ingress:
    className: traefik
    annotations:
      traefik.ingress.kubernetes.io/router.entrypoints: websecure
      traefik.ingress.kubernetes.io/router.tls: "true"
      traefik.ingress.kubernetes.io/router.tls.certresolver: cloudflare
  ```
- **Tailscale operator** — no ingress, expose the web service on your tailnet
  (Tailscale serves HTTPS, which satisfies the WebCrypto requirement):
  ```yaml
  ingress:
    enabled: false
  web:
    service:
      type: LoadBalancer
      loadBalancerClass: tailscale
      annotations:
        tailscale.com/hostname: "iteq"
  ```
- **cloudflared** — `ingress.enabled=false`, point the tunnel at
  `http://<release>-web:8080`; Cloudflare terminates TLS.

## Key values

| Value | Default | Meaning |
|---|---|---|
| `adminUsers` | `"quinten"` | Comma-separated usernames that are auto-approved and act as admins |
| `adminSetupCode` | `""` | Code required to *claim* an admin username at signup — set it on public deployments |
| `ingress.host` | `localhost` | Your hostname |
| `ingress.className` | `nginx` | Any ingress class; nginx gets helper annotations automatically |
| `web.service.*` | `ClusterIP` | Type/annotations/loadBalancerClass for the web entrypoint (tailscale etc.) |
| `ingress.certManagerClusterIssuer` | `""` | cert-manager ClusterIssuer; empty = bring your own TLS secret |
| `storage.size` / `storage.className` | `100Gi` / `""` | RWX volume for persistent chats (ciphertext) |
| `postgres.cnpg.enabled` | `true` | Provision a CNPG cluster; disable to bring your own DB |
| `postgres.existingUriSecret` | `""` | Secret with a `uri` key when bringing your own Postgres |
| `redis.maxmemory` | `8gb` | RAM budget for non-persistent chats (persistence is off on purpose) |
| `redis.auth.enabled` | `true` | Password-protect Redis (it holds sessions + RAM-chat ciphertext) |
| `redis.auth.existingSecret` | `""` | Pre-created Secret with the password — **required for Argo CD / Flux**, see below |
| `networkPolicy.enabled` | `true` | Restrict Redis to the api pods (needs a NetworkPolicy-enforcing CNI) |
| `api.trustProxyHops` | `1` | Reverse-proxy hops in front of the api, used to resolve the client ip for rate limits |
| `retention.contentDays` | `7` | Chat content lifetime (both storage modes) |
| `retention.bigFileDays` | `3` | Lifetime for files over 5 GB |
| `retention.accountDays` | `180` | Unused accounts are deleted after this |
| `push.vapidPublicKey` / `push.vapidPrivateKey` | `""` | VAPID keypair for Web Push; empty = push disabled |
| `push.vapidSubject` | `mailto:admin@example.com` | Contact URI required by the VAPID spec |
| `push.existingSecret` | `""` | Secret with `vapidPublicKey`/`vapidPrivateKey` instead of inline values |
| `api.hpa.*` / `web.hpa.*` | on | Autoscaling ranges |

### Redis password and GitOps

The chart generates the Redis password at install and reuses it on upgrade by
looking the Secret back up in the cluster. That lookup only works against a
live cluster, so renderers that run plain `helm template` — Argo CD, Flux's
default — would generate a **new password on every sync**. Deploying that way,
create the Secret once and point the chart at it:

```bash
kubectl -n iteq create secret generic iteq-redis-auth \
  --from-literal=redis-password="$(openssl rand -hex 32)"
helm upgrade ... --set redis.auth.existingSecret=iteq-redis-auth
```

To rotate a generated password: delete `<release>-redis-auth`, then upgrade.
(Everyone gets logged out, since sessions live in Redis.)

All values: [values.yaml](values.yaml). Storage semantics, crypto details and
the full story: [main README](https://github.com/TEQ-cloud/iteq#readme).

> The web UI's texts state the default limits (7 days, 1/2/5 GB, 6 months);
> changing the values changes enforcement, not the built-in copy.
