# Argo CD Image Updater — Bootstrap & Operations

> Installed by bug.0344 to retire hand-curated overlay-digest maintenance on `main`.
> Manifests: `infra/k8s/argocd/image-updater/`
> Watches: **preview** ApplicationSet's Applications → writes to `main`'s `infra/k8s/overlays/preview/<app>/kustomization.yaml` (MVP scope). Candidate-a was descoped post-#974 merge (write rate vs. seed-value trade-off — see `candidate-a-applicationset.yaml` docstring). Production is human-gated via `promote-to-production.yml`. Scope is enforced by an allowlist in `scripts/ci/check-image-updater-scope.sh`.

## What it does

Argo CD Image Updater runs as a Deployment in the `argocd` namespace. Every 2 minutes (default poll interval) it:

1. Lists all Argo CD `Application`s carrying the annotation `argocd-image-updater.argoproj.io/image-list`.
2. For each matched Application, scans GHCR for tags matching the Application's `allow-tags` regex.
3. Picks the newest tag by image-manifest creation timestamp (`update-strategy: latest` — v0.15.2's name for build-time-ordered selection, filtered by the `allow-tags` regex).
4. If the newest tag's digest differs from the one currently rendered in the Application's Kustomize overlay, clones `main`, rewrites the `digest:` field in `infra/k8s/overlays/preview/<app>/kustomization.yaml`, and pushes the commit back to `main` under PAT `ACTIONS_AUTOMATION_BOT_PAT` (pusher = `Cogni-1729`, authored as `github-actions[bot]` — matching `scripts/ci/promote-k8s-image.sh`, the script whose job this automates).

Every Application carries two image aliases pointing at **distinct GHCR packages** (bug.0344 B8 split) — `app=ghcr.io/cogni-dao/cogni-template` and `migrator=ghcr.io/cogni-dao/cogni-template-migrate` — so the image updater keeps both the primary app digest and the per-node migrator digest fresh on `main`. The split is load-bearing: the image updater's `ContainsImage` matcher (`pkg/image/image.go:148`) keys by `RegistryURL+ImageName`, so two aliases pointing at the same package would collapse to a single `Status.Summary.Images` entry and only one of {app, migrator} would update per poll in steady state — re-exposing bug #970. Distinct ImageNames give the two aliases independent Status entries. `scheduler-worker` has no migrator (single `images:` entry in its overlay); its migrator regex matches zero tags in the migrate package so the image updater silently no-ops.

Every commit is prefixed `chore(deps): argocd-image-updater` so `git log --grep='argocd-image-updater' -- infra/k8s/overlays/` is the controller-specific audit filter, and `git log --author='github-actions\[bot\]' -- infra/k8s/overlays/` is the broader CI-bot audit filter.

## Bootstrap: automated via `deploy-infra.sh` (the only supported path)

The Argo CD Image Updater bootstrap is **not** a standalone runbook step you run once by hand — it's **Step 7b** of `scripts/ci/deploy-infra.sh`, idempotent, and re-runs on every infra lever dispatch (invariant `ARGO_CD_IMAGE_UPDATER_BOOTSTRAP_IN_DEPLOY_INFRA` in bug.0344). Every dispatch of `candidate-flight-infra.yml` (candidate-a) and the `deploy-infra` job in `promote-and-deploy.yml` (preview/production) does all of the following:

1. `rsync infra/k8s/argocd/image-updater/ → root@$VM_HOST:/opt/cogni-template-argocd-updater/`.
2. Upserts the two `argocd`-namespace Secrets (`argocd-image-updater-ghcr` + `argocd-image-updater-git-creds`) via `kubectl create secret generic ... | kubectl apply -f -` — same pattern as the per-node app secrets in Step 7. ksops was retired (`infra/provision/cherry/base/bootstrap.yaml`, task.0284 ESO migration), so these Secrets are **not** committed to git; they're rotated into the cluster directly from GitHub Environment secrets at CD time.
3. `kubectl kustomize /opt/cogni-template-argocd-updater/ | kubectl apply -f -` — pulls the upstream `v0.15.2` install manifest + applies the local `config-patch.yaml` (GHCR registry, commit authorship, commit-message template).
4. `kubectl rollout restart deployment/argocd-image-updater -n argocd` + `kubectl rollout status … --timeout=120s` — forces the controller to pick up rotated Secret values immediately (the controller caches creds on startup per upstream v0.15.2 docs).

The two GitHub-Environment secrets that feed this path (same ones that already power other automated pushes to main):

- `GHCR_DEPLOY_TOKEN` — GHCR `read:packages` PAT, shared with every other pull consumer.
- `ACTIONS_AUTOMATION_BOT_PAT` — git push PAT (`Cogni-1729`), shared with `release.yml`, `promote-to-production.yml`, `promote-and-deploy.yml`, and `flight-preview.yml`.

Adding the image-updater controller or rotating either PAT is therefore a **workflow dispatch**, not a kubectl session:

```bash
# candidate-a:
gh workflow run candidate-flight-infra.yml

# preview / production (full promotion):
gh workflow run promote-and-deploy.yml -f environment=preview -f head_sha=<sha>
```

Step 7b skips gracefully (and logs a warning, not an error) when the `argocd` namespace doesn't exist yet (very first cluster bootstrap, before Argo CD itself is installed), when any of the three required env vars (`ACTIONS_AUTOMATION_BOT_PAT` / `GHCR_DEPLOY_TOKEN` / `GHCR_USERNAME`) are unset (legacy caller during rollout), or when `/opt/cogni-template-argocd-updater/` isn't on the VM (caller didn't rsync). **Do not copy the manual kubectl commands into a wiki page and have ops run them by hand** — every hand-applied command that isn't in `deploy-infra.sh` is a drift risk by construction (the dedicated [Deterministic reproducibility](../../AGENTS.md#workflow-guiding-principles) principle).

### Pre-flight (run once when bootstrapping a fresh cluster)

Two prerequisites must hold before Step 7b can succeed on a new cluster:

1. **Argo CD itself must be installed** (the `argocd` namespace + `install.yaml` from `infra/k8s/argocd/kustomization.yaml`) — bootstrap path lives in `infra/provision/cherry/base/bootstrap.yaml` and `scripts/setup/provision-test-vm.sh`. Until that lands on the VM, Step 7b no-ops harmlessly.
2. **The main-branch carve-out must be in place** — admin + `enforce_admins: false` on `main`'s branch protection. The image updater's write-back silently 403s every commit otherwise, into a log no one reads:

   ```bash
   gh api repos/cogni-dao/cogni-template/branches/main/protection \
     | jq -e '.enforce_admins.enabled == false'
   ```

   If this returns `false` (the jq assertion fails), stop. Either restore the carve-out or decline to enable the image updater until there's an explicit decision about how writes to `main` will authenticate.

### Confirm it's scanning (post-dispatch)

```bash
ssh root@<vm-host> "kubectl logs -n argocd deployment/argocd-image-updater --tail=50 | grep -i 'considering\|updated image'"
```

Within one poll cycle (≤2 minutes after the workflow finishes) you should see `considering image` lines for each annotated Application in the preview environment: `preview-{operator,poly,resy,scheduler-worker}`. Candidate-a Applications are present on the controller's candidate-a VM but carry no image-updater annotations (post-#974 descope), so the controller logs `considering 0 annotated application(s)` there.

## Smoke test (end-to-end)

Exercise the loop on poly — this is the most frequent flight path and the case bug.0344 was opened for (bug #970's migrator-seed-rot mechanism lives here).

1. Capture the current digests for `preview-poly` on main. Poly's overlay has two `images:` entries — both must refresh:

   ```bash
   git show main:infra/k8s/overlays/preview/poly/kustomization.yaml \
     | grep -E '^\s*(name|digest):'
   # Expect two name/digest pairs: cogni-template and cogni-template-migrate.
   ```

2. Push a trivial whitespace change to `nodes/poly/app/...`, merge. This triggers `pr-build.yml` → `flight-preview.yml`, which re-tags the built images as `preview-<mergeSHA>-poly` and `preview-<mergeSHA>-poly-migrate` in GHCR.
3. Within ~5 minutes (one poll cycle + commit latency), expect one or two new commits on `main`:

   ```bash
   git log --grep='argocd-image-updater' --author='github-actions\[bot\]' \
     -- infra/k8s/overlays/preview/poly/
   ```

4. Both the `cogni-template` entry AND the `cogni-template-migrate` entry in `infra/k8s/overlays/preview/poly/kustomization.yaml` should show the new `sha256:...` values. If only the app digest refreshes and migrator stays stale, stop — that's bug #970's mechanism still live; investigate the `migrator` alias annotations first.
5. Unrelated-flight regression check: trigger a flight for a PR touching only `nodes/operator/**`. After the flight rsyncs `main → deploy/preview`, inspect `deploy/preview:infra/k8s/overlays/preview/poly/kustomization.yaml`. Both poly digests must match main's fresh seeds from step 4 — not the pre-Image-Updater values from step 1. Same check applies to `deploy/candidate-a` after a candidate flight.

### Steady-state confirmation (B11 post-rollout)

The smoke test above passes by timing luck during the pre-sync transient window. Run this **once** after the first successful smoke test to confirm the B8 GHCR-split is holding in steady state, not just in the transient:

1. Wait 10 minutes after the first image updater commit lands on `main` — long enough for `deploy/preview` to sync + Argo to reconcile + `Status.Summary.Images` to catch up.
2. `git revert <first-image-updater-commit-sha>` on `main`, `git push origin main`. This restores the stale seed for one poll cycle.
3. Watch the next 2–3 image updater polls:

   ```bash
   kubectl logs -n argocd deployment/argocd-image-updater -f \
     | grep -E 'Considering|Successfully updated image'
   ```

4. **Expected (split is healthy):** both aliases (`app` and `migrator`) fire per poll because their ImageNames (`cogni-template` vs `cogni-template-migrate`) are distinct; both digests restored to main in both overlays within one cycle.
5. **Failure mode (split is incomplete):** only one alias ever fires (or always the same one) across 3 consecutive cycles. Stop. Inspect `kubectl get application -n argocd preview-poly -o jsonpath='{.status.summary.images}'` — if `cogni-template` and `cogni-template-migrate` are not both present as distinct entries, one of build-and-push/flight-preview-retag/overlay-`newName:`/registries-conf did not fully land on both packages. Re-audit bug.0344 § B8 checklist. Do **not** paper over with `force-update: "true"`.

If step 4 shows no commit after 10 minutes:

- Check controller logs: `kubectl logs -n argocd deployment/argocd-image-updater --tail=200`.
- Look for `error updating image` or registry auth errors (401/403 from ghcr.io → GHCR secret is wrong).
- Look for `error writing back to git` (GitHub 403 → git-creds PAT expired/revoked **or** branch protection on main rejected the push — verify `enforce_admins: false` still holds via `gh api repos/:owner/:repo/branches/main/protection`).
- Look for `no newer version found` for the `migrator` alias on scheduler-worker — that's expected (no migrator image exists for it) and safe to ignore.

## MVP scope

| Environment                               | Who writes the digest                                                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main:infra/k8s/overlays/preview/`        | Image updater — preview AppSet annotations                                                                                                                                                         |
| `main:infra/k8s/overlays/candidate-a/`    | **Nobody.** Developer-reference artifact only; `candidate-flight.yml` unconditionally overwrites `deploy/candidate-a`. Guardrail: `check-image-updater-scope.sh` (allowlist excludes candidate-a). |
| `main:infra/k8s/overlays/production/`     | Human-gated only. `promote-to-production.yml` reads from `deploy/preview` and opens a review PR to `deploy/production`. Guardrail: same script as candidate-a.                                     |
| `deploy/{preview,candidate-a,production}` | Flight workflows (`flight-preview.yml`, `candidate-flight.yml`, `promote-and-deploy.yml`) via `promote-k8s-image.sh`                                                                               |

Per-node migrator digests (`-operator-migrate`, `-poly-migrate`, `-resy-migrate`) are covered via the `migrator` image alias pointing at the split `cogni-template-migrate` GHCR package (bug.0344 B8). `scheduler-worker` has no migrator and silently no-ops.

### Scope-guard invariant (enforced)

`scripts/ci/check-image-updater-scope.sh` enforces a positive allowlist of AppSets permitted to carry `argocd-image-updater.argoproj.io/*` annotations. Current allowlist: `preview-applicationset.yaml` only. Every other `*-applicationset.yaml` under `infra/k8s/argocd/` (currently candidate-a + production) must be annotation-free and fails the CI `unit` job if it isn't. Adding a new AppSet to the allowlist is a design decision — edit the `ALLOWLIST` array in the script with an accompanying rationale; don't silently annotate. See `candidate-a-applicationset.yaml` docstring for why candidate-a was descoped post-#974.

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
- Remove the `argocd-image-updater.argoproj.io/*` annotations from `infra/k8s/argocd/preview-applicationset.yaml` (candidate-a + production are already annotation-free and enforced by the guardrail).
- Delete the controller: `kubectl delete deployment argocd-image-updater -n argocd`.

The bespoke anti-pattern `promote-k8s-image.sh` still works for every environment, so rolling back does not break flights — it just means you're back to hand-maintained `main` seeds (bug.0344 is reopened).

## PAT rotation

Rotations land via the same workflow dispatch that bootstrapped the controller — there is no out-of-band kubectl command. Both PATs (`ACTIONS_AUTOMATION_BOT_PAT`, `GHCR_DEPLOY_TOKEN`) live only as GitHub Environment secrets; rotating them in the Environment and re-dispatching `candidate-flight-infra.yml` (for candidate-a) or `promote-and-deploy.yml` (for preview/production) lets `deploy-infra.sh` Step 7b upsert the new values into the cluster and restart the controller to pick them up. Procedure:

1. Rotate the PAT upstream (GitHub → Settings → Developer settings → Personal access tokens, or per `docs/runbooks/SECRET_ROTATION.md`).
2. Update the GitHub Environment secret (`candidate-a` + `preview` + `production` Environments for `ACTIONS_AUTOMATION_BOT_PAT`; same environments plus any other GHCR-pulling workflow envs for `GHCR_DEPLOY_TOKEN`).
3. Dispatch the infra lever for each affected environment:

   ```bash
   gh workflow run candidate-flight-infra.yml               # candidate-a
   gh workflow run promote-and-deploy.yml -f environment=preview -f head_sha=<current-main-sha>
   gh workflow run promote-and-deploy.yml -f environment=production -f head_sha=<current-prod-sha>
   ```

4. Confirm the controller picked up the new credentials:

   ```bash
   ssh root@<vm-host> "kubectl logs -n argocd deployment/argocd-image-updater --tail=20 | grep -iE 'successfully|401|403'"
   ```

Step 7b is idempotent, so re-dispatching without a rotation is a safe no-op.

## Upgrades

We pin `v0.15.2` of `argocd-image-updater` — the last upstream release explicitly tested against Argo CD `v2.13.x` (which is what Cogni's argocd namespace runs). Upgrading Image Updater is tied to the Argo CD server upgrade:

1. Bump Argo CD in `infra/k8s/argocd/kustomization.yaml` to v2.14+ or v3.x.
2. Bump Image Updater pin in `infra/k8s/argocd/image-updater/kustomization.yaml` to the matching compatibility release.
3. Re-run the smoke test above.

Do not bump Image Updater ahead of Argo CD — the API contract (Application `spec.source.kustomize.images`) has had breaking shape changes between v2 and v3.
