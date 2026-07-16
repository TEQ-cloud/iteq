# Releasing iTEQ

The short version: **bump two lines in Chart.yaml, commit, push a tag.**
Everything downstream is automated.

## What a tag push automates

Pushing a tag matching `v*` runs [.github/workflows/release.yml](.github/workflows/release.yml):

1. **Images** — multi-arch (amd64 + arm64) builds of `server/` and `web/`,
   pushed to `ghcr.io/teq-cloud/iteq-api` and `iteq-web`, tagged with the
   version (tag minus the `v`) **and** `latest`.
2. **Chart** — chart-releaser packages `charts/iteq`, attaches it to a GitHub
   release (`iteq-<chartversion>`), and updates `index.yaml` on `gh-pages`.
3. **Artifact Hub** — nothing to do: it polls `https://teq-cloud.github.io/iteq`
   on its own (roughly every 30 minutes) and picks up new chart versions
   automatically. No button, no webhook.

## What is NOT automated (your checklist)

- [ ] `charts/iteq/Chart.yaml`: bump **`version`** (chart) and **`appVersion`**
      (image tag). If you forget, images still build but **no new chart is
      published** (`skip_existing` silently skips the already-released version).
- [ ] `CHANGELOG.md`: add the release notes humans read.
- [ ] Raw manifests (`k8s/40-api.yaml`, `50-web.yaml`, `70-retention-cronjob.yaml`):
      pinned image tags + the `APP_VERSION` env — only relevant for the
      kustomize path; chart users get the new `appVersion` automatically.
- [ ] Compose defaults (`deploy/compose/docker-compose.yml`, `.env.example`).
- [ ] Landing-page roadmap (`web/src/App.jsx`) when a version ships features.
- [ ] **Deploying it** — a release publishes artifacts; your cluster updates
      when you `helm upgrade` (or Argo CD syncs your bumped values/chart).

## Example: releasing v0.2.0

```bash
# 1. bump versions (chart version and appVersion move together)
sed -i '' 's/^version:.*/version: 0.2.0/; s/^appVersion:.*/appVersion: 0.2.0/' charts/iteq/Chart.yaml

# 2. changelog + any manifest/compose tag bumps, then:
git add -A && git commit -m "Release 0.2.0"
git push origin main

# 3. the actual release
git tag v0.2.0
git push origin v0.2.0

# 4. watch it: https://github.com/TEQ-cloud/iteq/actions
#    verify:
helm repo update && helm search repo iteq            # new chart version listed
docker pull ghcr.io/teq-cloud/iteq-api:0.2.0         # image resolves

# 5. roll your own cluster
helm upgrade iteq iteq/iteq -n iteq -f charts/iteq/env/prod-values.yaml
kubectl -n iteq rollout status deploy/iteq-api
curl https://<your-host>/api/healthz                 # shows the running version
```

## Fixing a botched release

- **Re-release the same version** (nothing consumed it yet): fix, commit, then
  `git tag -f v0.2.0 && git push origin -f v0.2.0`. Images are overwritten;
  the chart job skips (already released) — if the *chart* itself was broken,
  delete the `iteq-0.2.0` GitHub release + tag first, then re-push.
- **Roll back a cluster**: `helm rollback iteq -n iteq` or
  `kubectl -n iteq rollout undo deploy/iteq-api`. Old image tags stay on GHCR
  forever, so pinning back is always possible.

## Conventions

- Git tag `v<appVersion>` (e.g. `v0.2.0`, `v0.2.1-beta`); image tag = that
  minus the `v`; chart `version` = plain semver, bumped every release.
- `latest` follows the newest tag — never deploy `latest` to the cluster;
  always pin.
