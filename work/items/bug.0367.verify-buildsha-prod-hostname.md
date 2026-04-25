---
id: bug.0367
type: bug
title: "verify-buildsha.sh hostname convention breaks production verify"
status: needs_review
revision: 1
priority: 2
rank: 2
estimate: 1
created: 2026-04-24
updated: 2026-04-24
project: proj.cicd-services-gitops
assignees: []
summary: "verify-buildsha.sh joins node and DOMAIN with a hyphen (`${node}-${DOMAIN}`). Works for candidate-a (DOMAIN=test.cognidao.org → poly-test.cognidao.org ✅) and preview (DOMAIN=preview.cognidao.org → poly-preview.cognidao.org ✅). Fails for production (DOMAIN=cognidao.org → poly-cognidao.org ❌) because the real production hostnames are dot-joined (poly.cognidao.org). Every production verify-deploy job fails even when pods are healthy at the expected buildSha."
outcome: "Production promote-and-deploy verify-deploy passes (exit 0) when all expected buildShas are live at their real hostnames. Candidate-a and preview behavior unchanged."
---

# Bug: verify-buildsha.sh hostname convention breaks production verify

## Symptoms

- `promote-and-deploy.yml environment=production` fails at `verify-deploy` with `returned no parseable buildSha (body: )` for poly and resy, while operator passes.
- Pods are actually healthy: `curl https://poly.cognidao.org/version` → HTTP 200 with correct buildSha.
- Run 24871010165 (2026-04-24, post-bug.0366 promote-forward) is the trigger case: promote-k8s ✅, deploy-infra ✅, verify ❌, verify-deploy ❌.

## Root cause

`scripts/ci/verify-buildsha.sh:218`:

```bash
host="${node}-${DOMAIN}"
```

The hyphen joiner assumes DOMAIN is already a dotted subdomain (`preview.cognidao.org`, `test.cognidao.org`). When DOMAIN is a bare apex (production: `cognidao.org`), the result is `poly-cognidao.org` — a name that has no functional A record in production DNS (real name is `poly.cognidao.org`).

Operator passes because it uses `${DOMAIN}` alone (line 216), which resolves in every environment.

## Evidence

| Env         | DOMAIN                 | hyphen-join                 | DNS |
| ----------- | ---------------------- | --------------------------- | --- |
| candidate-a | `test.cognidao.org`    | `poly-test.cognidao.org`    | ✅  |
| preview     | `preview.cognidao.org` | `poly-preview.cognidao.org` | ✅  |
| production  | `cognidao.org`         | `poly-cognidao.org`         | ❌  |

## Fix

Branch on DOMAIN shape: if it has two-or-more dots (subdomain form), use the hyphen joiner; if it's an apex (single dot), use the dot joiner. See the commit on branch `fix/bug.0367-verify-buildsha-prod-hostname` for the patch in `scripts/ci/verify-buildsha.sh`.

Preferred alternative considered and rejected: always dot-join and add DNS/Ingress for `poly.preview.cognidao.org` / `poly.test.cognidao.org`. Uniform, but larger DNS blast radius — not worth it for a verify-script fix.

## Impact

Not blocking: prod is actually healthy after run 24871010165, and deploy/production overlays are clean. Noise-level: every production promote-and-deploy dispatch will red-flag until fixed. Masks real failures.

## Validation

exercise: Dispatch `promote-and-deploy.yml environment=production skip_infra=true source_sha=<healthy sha>`.
observability: verify-deploy job exits 0. All 3 node endpoints (`cognidao.org`, `poly.cognidao.org`, `resy.cognidao.org`) report expected buildSha.
