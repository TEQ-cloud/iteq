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

```bash
helm repo add iteq https://teq-cloud.github.io/iteq
helm install iteq iteq/iteq -n iteq --create-namespace \
  --set ingress.host=chat.example.com \
  --set adminUsers=yourname \
  --set adminSetupCode=pick-a-code \
  --set storage.className=your-rwx-class
```

Then open your host, sign up with the admin username + the setup code (asked
automatically) — that account is auto-approved and approves everyone else from
the in-app 👥 panel.

## Key values

| Value | Default | Meaning |
|---|---|---|
| `adminUsers` | `"quinten"` | Comma-separated usernames that are auto-approved and act as admins |
| `adminSetupCode` | `""` | Code required to *claim* an admin username at signup — set it on public deployments |
| `ingress.host` | `i.teqcloud.net` | Your hostname |
| `ingress.certManagerClusterIssuer` | `""` | cert-manager ClusterIssuer; empty = bring your own TLS secret |
| `storage.size` / `storage.className` | `100Gi` / `""` | RWX volume for persistent chats (ciphertext) |
| `postgres.cnpg.enabled` | `true` | Provision a CNPG cluster; disable to bring your own DB |
| `postgres.existingUriSecret` | `""` | Secret with a `uri` key when bringing your own Postgres |
| `redis.maxmemory` | `8gb` | RAM budget for non-persistent chats (persistence is off on purpose) |
| `retention.contentDays` | `7` | Chat content lifetime (both storage modes) |
| `retention.bigFileDays` | `3` | Lifetime for files over 5 GB |
| `retention.accountDays` | `180` | Unused accounts are deleted after this |
| `api.hpa.*` / `web.hpa.*` | on | Autoscaling ranges |

All values: [values.yaml](values.yaml). Storage semantics, crypto details and
the full story: [main README](https://github.com/TEQ-cloud/iteq#readme).

> The web UI's texts state the default limits (7 days, 1/2/5 GB, 6 months);
> changing the values changes enforcement, not the built-in copy.
