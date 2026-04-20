---
id: bug.0336
type: bug
title: "preview `/api/v1/agent/register` returns 401 despite proxy.ts public-route exception"
status: needs_triage
priority: 1
rank: 10
estimate: 1
summary: 'On `preview.cognidao.org` (source_sha `c9d7cd520`), `POST /api/v1/agent/register` returns `{"error":"Unauthorized"}` even though `nodes/operator/app/src/proxy.ts` at that SHA explicitly exempts the route via `isPublicApiRoute`. Blocks Gate B paid-agent validation (docs/runbooks/GATE_B_PAID_AGENT_VALIDATION.md) and any external-agent onboarding against preview.'
outcome: "Anonymous POST to `/api/v1/agent/register` on preview returns 201 with a fresh agent apiKey + userId + billingAccountId, matching the behavior documented in `docs/guides/agent-api-validation.md` § Register."
spec_refs:
  - security-auth
  - agent-api-validation
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [preview, agent-api, auth, blocker-gate-b]
external_refs:
  - docs/guides/agent-api-validation.md
  - docs/runbooks/GATE_B_PAID_AGENT_VALIDATION.md
  - nodes/operator/app/src/proxy.ts
---

# preview `/api/v1/agent/register` returns 401

## Observations (2026-04-20, autonomous validation run)

### Reproduction

```bash
$ curl -sS -X POST https://preview.cognidao.org/api/v1/agent/register \
    -H "Content-Type: application/json" \
    -d '{"name":"gate-b-probe-autonomous"}' \
    -w "\nHTTP %{http_code}\n"
{"error":"Unauthorized"}
HTTP 401
```

Response headers include `via: 1.1 Caddy`, confirming the request reaches the Next.js app.

### Expected (per main + per preview SHA `c9d7cd520`)

`nodes/operator/app/src/proxy.ts` at `c9d7cd520` (the SHA preview is running — see `deploy/preview:.promote-state/source-sha-by-app.json`):

```ts
function isPublicApiRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/public/") ||
    pathname === "/api/v1/agent/register"
  );
}

// ...later in proxy()
if (isPublicApi) {
  return NextResponse.next();
}
```

And `nodes/operator/app/src/app/api/v1/agent/register/route.ts` declares `auth: { mode: "none" }`. So the route should be reachable anonymously.

### Other surfaces on preview

| Path                          | HTTP                       |
| ----------------------------- | -------------------------- |
| `/readyz`                     | 200                        |
| `/.well-known/agent.json`     | 404                        |
| `/api/meta/readyz`            | 404 (but `/readyz` is 200) |
| `/api/v1/agent/register` POST | 401                        |
| `/api/v1/ai/agents` GET       | 401                        |
| `/api/v1/public/` GET         | 401                        |
| `/api/v1/public/chat` GET     | 404                        |

Note: `/readyz` returns `{"status":"healthy","timestamp":"...","version":"0"}` — `version:"0"` is the `BUILD_SHA` unset sentinel (relatedly bug.0326 family). Preview is healthy but has no build-sha injected.

## Hypothesis

Three candidates, in descending likelihood:

1. **`AUTH_SECRET` env var missing on preview deploy.** In `proxy.ts`:

   ```ts
   const tokenSecret = authSecret || authOptions.secret;
   if (
     !tokenSecret &&
     pathname.startsWith("/api/v1/") &&
     !isAgentBearerRequest
   ) {
     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
   }
   ```

   The early-return on `isPublicApi` happens BEFORE this check, so an absent `AUTH_SECRET` _shouldn't_ 401 a public route — but the error shape `{"error":"Unauthorized"}` matches the one the proxy emits here, not what NextAuth middleware returns. Worth confirming on the live pod whether `AUTH_SECRET` is set and whether the proxy.ts file I'm reading is the same one the pod shipped.

2. **An edge Caddy rule or middleware ordering is inserted ahead of Next.js proxy.** `via: 1.1 Caddy` confirms Caddy fronts the node, and the `infra/compose/edge/configs/Caddyfile.tmpl` may have catch-all auth for `/api/v1/*`. Didn't find one in source, but preview's rendered Caddyfile should be inspected on the VM.

3. **The pod is running an older build than `source_sha` indicates.** If promote-k8s-image didn't actually roll the pods to the new image (bug.0326 family), the running code could predate the `/api/v1/agent/register` public exception.

## Validation required before concluding

- [ ] On the preview VM, `kubectl exec` into the operator pod and `cat /app/.next/server/...proxy.js` — does the built artifact contain the `/api/v1/agent/register` literal?
- [ ] `kubectl exec` → `env | grep AUTH_SECRET` — is the secret populated?
- [ ] Check Caddy's rendered config: `cat infra/compose/edge/configs/Caddyfile` on the preview VM — any auth middleware on `/api/v1/*`?
- [ ] Compare deployed pod image digest to the digest in `deploy/preview:infra/k8s/overlays/preview/operator/kustomization.yaml` — do they match?

## Impact

- **Blocks Gate B** (`docs/runbooks/GATE_B_PAID_AGENT_VALIDATION.md`) — every step in the runbook starts with agent register, which is unreachable.
- **Blocks any external-agent onboarding against preview** — `docs/guides/external-agent-onboarding.md` § Register cannot be executed.
- **Does not block merge-to-main or candidate-a flight** — those paths don't go through preview's register.

## Validation

- **exercise:** `curl -fsS -X POST https://preview.cognidao.org/api/v1/agent/register -H "Content-Type: application/json" -d '{"name":"bug-0336-fix-probe"}'` — must return HTTP 201 with a JSON body containing `apiKey` (prefix `cogni_ag_sk_v1_`), `userId`, and `billingAccountId`.
- **observability:** Loki `{app="operator", route="/api/v1/agent/register"}` on the deployed SHA must show a `request complete` log envelope with `statusCode: 201` for the probe call above.

## Suggested fix path

Triage sequence for whoever picks this up:

1. Reproduce locally with `pnpm dev:stack` — if local works, the bug is environmental (preview VM / overlay / Caddy).
2. SSH to preview VM, inspect actual pod env + Caddy config.
3. If `AUTH_SECRET` is missing, the fix is adding it to `preview-node-app-secrets` + re-dispatching `promote-and-deploy.yml`.
4. If Caddy has a stale auth rule, fix `Caddyfile.tmpl` and re-run `candidate-flight-infra.yml --ref main`.
5. If the pod is running stale code, investigate promote-k8s-image in the last preview flight.

## Related

- [bug.0326](bug.0326.wait-for-argocd-vacuous-green.md) — Argo "Healthy" fires before new pods live; same class of "preview looks green, actually stale"
- [PR #955](https://github.com/Cogni-DAO/node-template/pull/955) — Gate B runbook that assumes this endpoint works
- [docs/guides/agent-api-validation.md](../../docs/guides/agent-api-validation.md) — contract this route must satisfy
