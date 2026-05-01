---
id: bug.0440
type: bug
title: "deploy-infra.sh writes empty-string values into k8s secrets — silent landmine for any new optional env"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "OBSERVED: When a GitHub secret is unset, deploy-infra.sh forwards `${VAR:-}` (empty string) to the remote setup step, which writes a 0-byte value into the k8s Secret data field. Apps that read this secret get the empty string, not undefined. EXPECTED: Empty-value envs should be omitted from the k8s Secret entirely, so consumers see `undefined` and optional schemas work. REPRO: Set TAVILY_API_KEY GitHub secret to empty (or unset). Deploy. `kubectl get secret -o jsonpath='{.data.TAVILY_API_KEY}' | base64 -d | wc -c` → 0. IMPACT: Any optional env added in the future is a latent landmine — first deploy with an unset secret breaks readiness on a stricter validator."
outcome: "deploy-infra.sh (and setup-secrets.ts) skip envs whose value is empty after expansion. k8s secrets contain only keys with real values. App-side validators don't have to defensively wrap every optional in an emptyToUndefined preprocess — the values are simply absent."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-30
updated: 2026-04-30
labels: [reliability, deploy, secrets, defense-in-depth]
external_refs:
---

# deploy-infra.sh writes empty-string values into k8s secrets

## Problem

`scripts/ci/deploy-infra.sh:1244` and `scripts/setup-secrets.ts` build the k8s Secret payload from `${VAR:-}` expansions. Unset GitHub secrets become 0-byte values in the Secret. Apps consuming the Secret see an empty string for the env var — distinct from `undefined`.

This caused **bug.0439** (preview operator readyz failure on `TAVILY_API_KEY`). Bug.0439's fix is at the validator layer (use `optionalString` helper). This bug is the **defense-in-depth** counterpart at the deploy layer.

## Why both fixes are needed

- App side (bug.0439): every optional field must use `optionalString`. Easy to forget on the next new field. Still fails if someone uses bare `z.string().optional()`.
- Deploy side (this bug): drop empty values from the Secret manifest. App schema doesn't need defensive wrapping; standard Zod patterns work.

## Approach (separate PR)

In `setup-secrets.ts`, when assembling the Secret data block:

```ts
const data = Object.fromEntries(
  Object.entries(envs)
    .filter(([_, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, base64(v)])
);
```

Likewise in `deploy-infra.sh` when running `kubectl create secret --from-literal=KEY=VALUE`, skip pairs where VALUE is empty.

## Validation

```bash
# Set TAVILY_API_KEY="" in env, run deploy-infra.sh
kubectl get secret operator-node-app-secrets -o json \
  | jq '.data | keys'
# → no "TAVILY_API_KEY" key in the output
```
