---
id: bug.0439
type: bug
title: "TAVILY/KALSHI optional env vars reject empty strings — block pod readiness when k8s secret is unset"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "OBSERVED: Preview operator pod stuck Ready 0/1 for 28+ min with `EnvValidationError: invalid:['TAVILY_API_KEY']`. Old pod can't terminate, rolling update exceeds progress deadline, preview /api/v1/work/items returns 500 to all callers. EXPECTED: Optional env vars whose value is unset (or empty in k8s secret) should pass validation as undefined. REPRO: Deploy any node-app with TAVILY_API_KEY github secret unset → deploy-infra.sh writes 0-byte k8s secret value → Zod `z.string().min(1).optional()` rejects → readyz 500. IMPACT: ANY new deploy with this pattern stalls; if it's the only replica behind RollingUpdate maxUnavailable:0, prior version keeps serving but no new code lands."
outcome: "All 4 nodes' optional env fields use the existing `optionalString` helper (line ~30 of each server-env.ts) that maps empty-string → undefined. Pods boot cleanly even when an optional GitHub secret is unset."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
branch: fix/optional-env-empty-string-rejection
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-30
updated: 2026-04-30
labels: [reliability, env-validation, deploy, p0]
external_refs:
---

# TAVILY/KALSHI optional env vars reject empty strings

Filed during preview-recovery incident 2026-04-30 / 2026-05-01 UTC.

## Observed

Preview operator pod `operator-node-app-85b7b88499-smrdh`:

- Status: Running, Ready 0/1, 28m old
- Readiness probe: `HTTP probe failed with statuscode: 500` (318 failures)
- App logs:
  ```
  EnvValidationError: { code: 'INVALID_ENV', missing: [], invalid: ['TAVILY_API_KEY'] }
  ```

k8s secret check:

```
kubectl -n cogni-preview get secret operator-node-app-secrets \
  -o jsonpath='{.data.TAVILY_API_KEY}' | base64 -d | wc -c
→ 0
```

## Root cause

`scripts/ci/deploy-infra.sh:1244` forwards `TAVILY_API_KEY='${TAVILY_API_KEY:-}'` to the remote setup-secrets step. When the GitHub secret is unset, this is `''` (empty string), which gets written into the k8s secret as a 0-byte value.

The runtime validator `nodes/operator/app/src/shared/env/server-env.ts:195` uses `z.string().min(1).optional()` — `optional()` accepts `undefined`, but `min(1)` rejects empty strings. So an unset GitHub secret silently breaks pod boot.

The same broken pattern exists in **all 4 nodes** (operator, poly, resy, node-template) for `TAVILY_API_KEY`, `KALSHI_API_KEY`, `KALSHI_API_SECRET`. Explains why `verify-deploy (poly)` and `verify-deploy (scheduler-worker)` were also failing on multiple promote runs today.

## Fix (PR #1166)

Each `server-env.ts` already defines:

```ts
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v === "" ? undefined : v),
  z.string().min(1).optional()
);
```

Just use it for TAVILY/KALSHI fields instead of the bare `z.string().min(1).optional()`.

## Defense-in-depth (separate work — bug.0440)

`deploy-infra.sh` should skip writing empty-value envs to k8s secrets entirely, so this class of bug is impossible regardless of validator.

## Validation

After PR #1166 merges + auto-deploy:

```bash
curl https://preview.cognidao.org/version  # buildSha advances past 8b1227d6
curl https://preview.cognidao.org/api/v1/work/items \
  -H 'authorization: Bearer <key>'         # HTTP 200, items returned
ssh root@$(cat .local/preview-vm-ip) \
  "kubectl -n cogni-preview get pods | grep operator"
# → Ready 1/1; only one pod (old terminated)
```
