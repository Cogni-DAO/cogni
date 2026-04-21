# Argo CD Image Updater — Bootstrap & Operations

> Installed by bug.0344 to retire hand-curated overlay-digest maintenance on `main`.
> Manifests: `infra/k8s/argocd/image-updater/`
> Watches: preview ApplicationSet's Applications → writes to `main`'s `infra/k8s/overlays/preview/<app>/kustomization.yaml` only (MVP scope).

## What it does

Argo CD Image Updater runs as a Deployment in the `argocd` namespace. Every 2 minutes (default poll interval) it:

1. Lists all Argo CD `Application`s carrying the annotation `argocd-image-updater.argoproj.io/image-list`.
2. For each matched Application, scans GHCR for tags matching the Application's `allow-tags` regex.
3. Picks the newest tag by image-manifest creation timestamp (`update-strategy: latest` — v0.15.2's name for build-time-ordered selection, filtered by the `allow-tags` regex).
4. If the newest tag's digest differs from the one currently rendered in the Application's Kustomize overlay, clones `main`, rewrites the `digest:` field in `infra/k8s/overlays/preview/<app>/kustomization.yaml`, and pushes the commit back to `main` as `Cogni-1729`.

Every commit is prefixed `chore(deps): argocd-image-updater` so `git log --grep='argocd-image-updater' -- infra/k8s/overlays/` is the audit filter.

## One-time bootstrap

Run these once per cluster. Both credentials reuse existing repo-wide values — nothing new needs minting.

### 1. Create the two Kubernetes secrets imperatively

ksops was retired from this repo's Argo CD bootstrap (see `infra/provision/cherry/base/bootstrap.yaml`, task.0284 ESO migration). The Image Updater's two credentials are therefore created with `kubectl create secret generic --dry-run=client -o yaml | kubectl apply -f -` — the same idempotent-apply pattern `scripts/ci/deploy-infra.sh` uses for every other node secret. They are **not** committed to git.

Export the two values from your env (or 1Password), then apply both:

```bash
# GHCR read:packages PAT — same value used by every other pull consumer.
export GHCR_DEPLOY_TOKEN="<paste from secret store>"

# Git push PAT — same ACTIONS_AUTOMATION_BOT_PAT used by release.yml,
# promote-to-production.yml, promote-and-deploy.yml, flight-preview.yml.
export ACTIONS_AUTOMATION_BOT_PAT="<paste from secret store>"

# GHCR creds — Opaque Secret with `token` key; matches
# `credentials: secret:argocd/argocd-image-updater-ghcr#token` in config-patch.yaml.
kubectl -n argocd create secret generic argocd-image-updater-ghcr \
  --from-literal=token="Cogni-1729:${GHCR_DEPLOY_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -

# Git push creds — Opaque Secret with `username` + `password` keys; matches
# `write-back-method: git:secret:argocd/argocd-image-updater-git-creds` in
# preview-applicationset.yaml.
kubectl -n argocd create secret generic argocd-image-updater-git-creds \
  --from-literal=username="Cogni-1729" \
  --from-literal=password="${ACTIONS_AUTOMATION_BOT_PAT}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

These two commands are safe to re-run — `create --dry-run=client -o yaml | apply` upserts.

### 2. Apply the argocd Kustomize tree

This is the same one-shot hand-apply that bootstraps Argo CD itself. The Image Updater install slots in alongside:

```bash
kubectl kustomize infra/k8s/argocd/ | kubectl apply -f -
kubectl rollout status deployment/argocd-image-updater -n argocd --timeout=2m
```

### 3. Confirm it's scanning

```bash
kubectl logs -n argocd deployment/argocd-image-updater --tail=50 | grep -i 'considering\|updated image'
```

Within one poll cycle (≤2 minutes) you should see `considering image` lines for each annotated preview Application (`preview-operator`, `preview-poly`, `preview-resy`, `preview-scheduler-worker`).

## Smoke test (end-to-end)

On fresh bootstrap, exercise the full loop:

1. Capture the current digest for `preview-resy` on main:

   ```bash
   git show main:infra/k8s/overlays/preview/resy/kustomization.yaml | grep 'digest:'
   ```

2. Push a trivial whitespace change to `nodes/resy/app/...`, merge. This triggers `pr-build.yml` → `flight-preview.yml`, which re-tags the built image as `preview-<mergeSHA>-resy` in GHCR.
3. Within ~5 minutes (one poll cycle + commit latency), expect a new commit on `main`:

   ```bash
   git log --grep='argocd-image-updater' --author='Cogni-1729' -- infra/k8s/overlays/preview/resy/
   ```

4. The commit should bump the primary `ghcr.io/cogni-dao/cogni-template` image's `digest:` field to the new `sha256:...`.

If step 4 shows no commit after 10 minutes:

- Check controller logs: `kubectl logs -n argocd deployment/argocd-image-updater --tail=200`.
- Look for `error updating image` or registry auth errors (401/403 from ghcr.io → GHCR secret is wrong).
- Look for `error writing back to git` (gitHub 403 → git-creds PAT is expired/revoked).

## MVP scope — what is NOT covered yet

| Gap                                                          | Current owner                                               | Follow-up ticket                         |
| ------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------- |
| `main`'s `candidate-a/` overlays                             | Manual — still hand-bumped                                  | Extend to annotate candidate-a AppSet    |
| `main`'s `production/` overlays                              | Manual — `promote-to-production.yml` mirrors                | Follow-up — needs careful scoping        |
| Migrator image digests (`-poly-migrate`, `-resy-migrate`, …) | `promote-k8s-image.sh --migrator-digest` on deploy branches | Add a second image alias per Application |

These are deliberate cuts for MVP, not oversights. See bug.0344 § _MVP scope boundaries_.

## Rollback

If the controller misbehaves in a way that's causing broken commits to `main`:

```bash
# 1. Scale controller to 0 — stops any further commits immediately.
kubectl scale -n argocd deployment/argocd-image-updater --replicas=0

# 2. (Optional) revert the offending commit(s) on main.
git revert <bad-sha> && git push origin main
```

To disable permanently:

- Remove `image-updater` from `infra/k8s/argocd/kustomization.yaml` resources.
- Remove the `argocd-image-updater.argoproj.io/*` annotations from `infra/k8s/argocd/preview-applicationset.yaml`.
- Delete the controller: `kubectl delete deployment argocd-image-updater -n argocd`.

The bespoke anti-pattern `promote-k8s-image.sh` still works for every environment, so rolling back does not break flights — it just means you're back to hand-maintained `main` seeds (bug.0344 is reopened).

## PAT rotation

When `ACTIONS_AUTOMATION_BOT_PAT` rotates (see `docs/runbooks/SECRET_ROTATION.md`):

```bash
export ACTIONS_AUTOMATION_BOT_PAT="<new value>"

# Re-apply the Secret (idempotent upsert).
kubectl -n argocd create secret generic argocd-image-updater-git-creds \
  --from-literal=username="Cogni-1729" \
  --from-literal=password="${ACTIONS_AUTOMATION_BOT_PAT}" \
  --dry-run=client -o yaml | kubectl apply -f -

# Force controller reload (it caches creds on startup).
kubectl rollout restart deployment/argocd-image-updater -n argocd
```

Same procedure for `GHCR_DEPLOY_TOKEN`:

```bash
export GHCR_DEPLOY_TOKEN="<new value>"
kubectl -n argocd create secret generic argocd-image-updater-ghcr \
  --from-literal=token="Cogni-1729:${GHCR_DEPLOY_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/argocd-image-updater -n argocd
```

## Upgrades

We pin `v0.15.2` of `argocd-image-updater` — the last upstream release explicitly tested against Argo CD `v2.13.x` (which is what Cogni's argocd namespace runs). Upgrading Image Updater is tied to the Argo CD server upgrade:

1. Bump Argo CD in `infra/k8s/argocd/kustomization.yaml` to v2.14+ or v3.x.
2. Bump Image Updater pin in `infra/k8s/argocd/image-updater/kustomization.yaml` to the matching compatibility release.
3. Re-run the smoke test above.

Do not bump Image Updater ahead of Argo CD — the API contract (Application `spec.source.kustomize.images`) has had breaking shape changes between v2 and v3.
