---
id: candidate-a-cutover
type: handoff
work_item_id: task.0296
status: active
created: 2026-04-09
updated: 2026-04-09
branch: main
---

# Handoff: Canary VM to `candidate-a` Cutover

## Goal

Convert the existing multi-node canary VM into the first reusable pre-merge slot, `candidate-a`, without provisioning a new VM and without rotating the existing secret values.

This is a **control-plane cutover**, not a new environment build:

- keep the existing VM
- keep the existing Compose infra
- keep the existing secret values
- preserve the currently running canary image digests
- switch Argo and CI control from `deploy/canary` to `deploy/candidate-a`

## Current Facts

- `#851` is merged to `main`
- the `Candidate Flight` and `PR Build` workflows now exist on `main`
- `origin/deploy/candidate-a` does **not** exist yet
- `origin/deploy/canary` **does** exist and is the live source of truth for the current canary slot
- the live `deploy/canary` digests are newer than the placeholder values in `main`
- `candidate-a` overlays in `main` currently point at:
  - `candidate-a.cognidao.org`
  - `poly-candidate-a.cognidao.org`
  - `resy-candidate-a.cognidao.org`
- the physical canary slot is currently reachable at:
  - `test.cognidao.org`
  - `poly-test.cognidao.org`
  - `resy-test.cognidao.org`

## Important Constraint

`Candidate Flight` syncs `infra/k8s/overlays/candidate-a/` from `main` into `deploy/candidate-a` before every flight.

That means the chosen slot URL model must be represented in `main`, not just patched once on the deploy branch.

## Recommended Domain Strategy

For the fastest cutover, **reuse the existing canary hostnames first**:

- operator: `test.cognidao.org`
- poly: `poly-test.cognidao.org`
- resy: `resy-test.cognidao.org`

Why this is recommended:

- no new DNS records required
- no edge reconfiguration required
- existing TLS/canary ingress path stays intact
- the cutover stays focused on Argo + deploy-branch ownership

### Consequence

Before the **first real candidate flight**, `main` should get one small follow-up patch that changes the `candidate-a` overlay `NEXTAUTH_URL` values to the reused test hostnames.

If that follow-up patch is skipped, the next candidate-flight sync will overwrite the slot back to `candidate-a.cognidao.org` URLs.

## Cutover Overview

Do the cutover in four phases:

1. Pre-stage `deploy/candidate-a` from the live `deploy/canary` branch
2. Pre-stage the `cogni-candidate-a` namespace and copy secrets
3. Cut Argo ownership from canary to `candidate-a`
4. Verify baseline health, then begin manual PR flighting

## Phase 1: Seed `deploy/candidate-a`

Source of truth: **current live** `origin/deploy/canary`

Run from a clean local checkout:

```bash
git fetch origin

BOOTSTRAP_DIR="$(mktemp -d)"
git clone --branch deploy/canary --single-branch git@github.com:Cogni-DAO/node-template.git "$BOOTSTRAP_DIR"
cd "$BOOTSTRAP_DIR"

mkdir -p infra/k8s/overlays/candidate-a
cp -R infra/k8s/overlays/canary/. infra/k8s/overlays/candidate-a/
mkdir -p infra/control
```

Rewrite the copied overlays from canary namespace semantics to `candidate-a` while preserving the live digests:

```bash
python3 <<'PY'
from pathlib import Path

files = sorted(Path("infra/k8s/overlays/candidate-a").glob("*/kustomization.yaml"))
for path in files:
    text = path.read_text()
    text = text.replace("namespace: cogni-canary", "namespace: cogni-candidate-a")
    text = text.replace("cogni-canary", "cogni-candidate-a")
    text = text.replace("staging-placeholder-scheduler-worker", "candidate-a-placeholder-scheduler-worker")
    text = text.replace("staging-placeholder-sandbox-openclaw", "candidate-a-placeholder-sandbox-openclaw")
    path.write_text(text)
PY
```

Seed an explicit free lease file:

```bash
cat > infra/control/candidate-lease.json <<'EOF'
{
  "slot": "candidate-a",
  "state": "free",
  "released_at": "2026-04-09T00:00:00Z"
}
EOF
```

Commit and publish the new deploy branch:

```bash
git add infra/k8s/overlays/candidate-a infra/control/candidate-lease.json
git commit -m "bootstrap(candidate-a): seed deploy branch from live canary slot"
git push origin HEAD:deploy/candidate-a
```

## Phase 2: Pre-Stage Namespace and Secrets

This can be done **before** cutting Argo over.

Create the target namespace:

```bash
kubectl get namespace cogni-candidate-a >/dev/null 2>&1 || kubectl create namespace cogni-candidate-a
```

Copy the existing canary secrets into the new namespace without changing values:

```bash
for name in \
  operator-node-app-secrets \
  poly-node-app-secrets \
  resy-node-app-secrets \
  scheduler-worker-secrets \
  sandbox-openclaw-secrets
do
  kubectl get secret "$name" -n cogni-canary -o json | python3 -c '
import json, sys
doc = json.load(sys.stdin)
doc["metadata"]["namespace"] = "cogni-candidate-a"
for key in ("uid", "resourceVersion", "creationTimestamp", "managedFields"):
    doc["metadata"].pop(key, None)
print(json.dumps(doc))
' | kubectl apply -f -
done
```

Verify they all exist:

```bash
for name in \
  operator-node-app-secrets \
  poly-node-app-secrets \
  resy-node-app-secrets \
  scheduler-worker-secrets \
  sandbox-openclaw-secrets
do
  kubectl get secret "$name" -n cogni-candidate-a
done
```

## Phase 3: Apply `candidate-a` ApplicationSet

Apply only the new ApplicationSet file. Do **not** re-apply the full Argo install bundle on the live cluster.

```bash
kubectl apply -n argocd -f infra/k8s/argocd/candidate-a-applicationset.yaml
```

At this point the `candidate-a` Applications may appear, but the services cannot successfully bind while the old canary apps still own the shared NodePorts.

## Phase 4: Cut Argo Ownership From Canary to `candidate-a`

Because canary and `candidate-a` use the same NodePorts, they cannot run side-by-side on the same cluster.

Expected downtime: short Argo resync window.

### 4.1 Remove the old canary Applications

Delete the old Argo apps first:

```bash
kubectl -n argocd delete application \
  canary-operator \
  canary-poly \
  canary-resy \
  canary-scheduler-worker \
  canary-sandbox-openclaw \
  --ignore-not-found=true
```

Then remove the old ApplicationSet:

```bash
kubectl -n argocd delete applicationset cogni-canary --ignore-not-found=true
```

Optional cleanup after `candidate-a` is healthy:

```bash
kubectl delete namespace cogni-canary --ignore-not-found=true
```

### 4.2 Wait for `candidate-a` to become healthy

Watch the new Argo applications:

```bash
kubectl -n argocd get applications | rg 'candidate-a-'
```

Watch the new namespace:

```bash
kubectl -n cogni-candidate-a get pods -w
```

## Phase 5: Set the GitHub Actions Environment Variable

The `Candidate Flight` workflow reads `vars.DOMAIN` from the GitHub environment named `candidate-a`.

If reusing the current canary hostnames, set:

```bash
gh variable set DOMAIN \
  --repo Cogni-DAO/node-template \
  --env candidate-a \
  --body "test.cognidao.org"
```

This makes the workflow probe:

- `https://test.cognidao.org`
- `https://poly-test.cognidao.org`
- `https://resy-test.cognidao.org`

## Phase 6: Baseline Verification

Do not attempt the first PR flight until these pass:

```bash
curl -sk https://test.cognidao.org/readyz
curl -sk https://poly-test.cognidao.org/readyz
curl -sk https://resy-test.cognidao.org/readyz

curl -sk https://test.cognidao.org/livez
curl -sk https://poly-test.cognidao.org/livez
curl -sk https://resy-test.cognidao.org/livez
```

Also verify:

```bash
kubectl -n cogni-candidate-a get pods
kubectl -n argocd get applications | rg 'candidate-a-'
kubectl -n cogni-candidate-a get secret operator-node-app-secrets
kubectl -n cogni-candidate-a get secret poly-node-app-secrets
kubectl -n cogni-candidate-a get secret resy-node-app-secrets
kubectl -n cogni-candidate-a get secret scheduler-worker-secrets
```

## First Real Candidate Flight

Once the baseline slot is healthy:

1. choose a backlog PR
2. update that PR branch so it picks up merged `main`
3. wait for `PR Build` to publish fresh GHCR images for the PR head SHA
4. manually dispatch `Candidate Flight`

At that point the pre-merge slot is live and callable.

## Required Follow-Up On `main`

To keep the reused canary hostnames stable across future candidate flights, add one small follow-up patch on `main`:

- `infra/k8s/overlays/candidate-a/operator/kustomization.yaml`
- `infra/k8s/overlays/candidate-a/poly/kustomization.yaml`
- `infra/k8s/overlays/candidate-a/resy/kustomization.yaml`

Change:

- `https://candidate-a.cognidao.org` → `https://test.cognidao.org`
- `https://poly-candidate-a.cognidao.org` → `https://poly-test.cognidao.org`
- `https://resy-candidate-a.cognidao.org` → `https://resy-test.cognidao.org`

Without that patch, `Candidate Flight` will re-sync the branch from `main` and restore the `candidate-a.cognidao.org` URLs on the next run.

## Decision Log

- **Use the existing canary VM:** yes
- **Preserve existing secret values:** yes
- **Seed from live `deploy/canary`:** yes
- **Run canary and `candidate-a` in parallel:** no
- **Reuse current canary hostnames first:** yes, recommended
- **Require one small follow-up patch on `main` for stable hostnames:** yes
