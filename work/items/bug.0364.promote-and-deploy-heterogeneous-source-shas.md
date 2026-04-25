---
id: bug.0364
type: bug
title: "promote-and-deploy: production can't promote heterogeneous preview (single source_sha assumption)"
status: needs_review
revision: 1
priority: 1
rank: 1
estimate: 1
created: 2026-04-23
updated: 2026-04-23
project: proj.cicd-services-gitops
assignees: []
summary: "Dispatching promote-and-deploy for production with any single source_sha silently no-ops because affected-only CI produces a preview with per-app source SHAs (poly@4c793b5, others@c2ecbb2), and the workflow resolves every target under one preview-<source_sha> tag. All digests come back empty → 'No overlay changes (digests unchanged)' → production never advances."
outcome: "Dispatching promote-and-deploy environment=production (no source_sha) copies every currently-live preview digest + per-app source_sha map forward to deploy/production in one atomic push, regardless of how many PR source SHAs contributed to preview."
---

# Bug: promote-and-deploy can't promote a heterogeneous preview to production

## Symptoms

1. Prod poly DB unmigrated for ~1 week. `poly_copy_trade_*` / `poly_wallet_connections` tables don't exist (verified via Loki `{service="app",env="production"} |~ "relation.*does not exist"`).
2. Argo PreSync on `cogni-production/poly-migrate-node-app` wedged: `Job was active longer than specified deadline`. Repeats every ~minute.
3. Multiple `promote-and-deploy.yml environment=production` dispatches over 2+ hours all silent-greened with `No overlay changes (digests unchanged)` despite no digests ever reaching deploy/production.

## Root cause

`.github/workflows/promote-and-deploy.yml` (promote-k8s job, "Resolve all image digests" step):

```bash
TAG="preview-${HEAD_SHA}"
for target in "${ALL_TARGETS[@]}"; do
  full_tag=$(image_tag_for_target "$(image_name_for_target "$target")" "$TAG" "$target")
  digest=$(resolve_optional "$full_tag")   # empty string when not found
  ...
done
```

The workflow resolves every target under a single `preview-<source_sha>` tag. Affected-only CI breaks this assumption:

```
deploy/preview/.promote-state/source-sha-by-app.json:
{
  "operator":          "c2ecbb26…",
  "poly":              "4c793b52…",   ← only one rebuilt recently
  "resy":              "c2ecbb26…",
  "scheduler-worker":  "c2ecbb26…"
}
```

No single SHA tag resolves all four. Dispatching with the preview `current-sha` (main tip `c644f17…`) resolves **zero** — nothing was built at that SHA. `resolve_optional` returns empty, `promote_app` skips on empty digest, overlay unchanged, silent no-op.

Separate latent issue: prod overlays on **main** still carry pre-promotion placeholders — `newTag: prod-placeholder-<node>` + `newName: ghcr.io/cogni-dao/cogni-template` on the migrator line (wrong repo; remaps migrator to the app image). `promote-k8s-image.sh` fixes both during a real promotion (lines 76-99). But no real promotion has ever run against production, so the broken state sits on main indefinitely.

PR #1018 removed an `exit 0` stub patch on the migrator Job that was masking this. Post-#1018, the unfixed overlay causes the migrator pod to pull the app image, start Next.js, hit `activeDeadlineSeconds: 300`, Job fails, Argo PreSync fails.

## Fix

Promote-and-deploy for `environment=production` resolves digests **by reading deploy/preview's current overlay state**, not by looking up a single GHCR tag. Preview's overlays already contain per-app resolved digests; promotion to production = copy those digests forward + copy the per-app source-sha map forward.

- New script: `scripts/ci/resolve-digests-from-preview.sh` — checks out `deploy/preview`, parses `infra/k8s/overlays/preview/<app>/kustomization.yaml` for app + migrator digests per target in `NODE_TARGETS`, emits the same JSON shape as the existing GHCR resolver.
- Workflow: when `environment=production` and `source_sha` is empty, call the new resolver instead of the GHCR tag lookup, and copy `deploy/preview/.promote-state/source-sha-by-app.json` forward. When `source_sha` is supplied, preserve the existing per-SHA lookup behavior (emergency-hotfix escape hatch).
- Verify-buildsha already runs in `SOURCE_SHA_MAP` mode (bug.0321 Fix 4), so heterogeneous SHAs verify correctly once the map is copied.

## Validation

- exercise: Dispatch `promote-and-deploy.yml environment=production` with empty `source_sha`. Expect `promoted_apps` to cover all four nodes; `deploy/production` receives a real digest promotion; Argo PreSync on `poly-migrate-node-app` completes (migrator runs drizzle, not Next.js); verify-deploy job passes; `curl https://poly.cognidao.org/api/v1/poly/wallet/status` with bearer token returns 200 (not 500 on missing tables).
- observability: Loki `{service="app",env="production"} |~ "poly.mirror.targets.reconcile.tick_error"` stops. `poly-node-app` pods on `cogni-production` are on the new ReplicaSet (digest matches preview poly digest). No `relation.*does not exist` errors.

## Non-goals

- Changing emergency-hotfix dispatch (pass `source_sha=<sha>` + optional `build_sha`). Still supported.
- Teaching the GHCR resolver about multiple SHAs. Preview-overlay-forward is the right primitive: preview has already proven those exact digests.
- Fixing `poly-doltgres` divergence between preview (has `../../../base/poly-doltgres` base) and prod (doesn't). Separate followup — not blocking tonight's schema unblock.
