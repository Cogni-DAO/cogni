---
id: task.0406
type: task
title: "Wire PostHog access for data agents — close the client-perf observability gap"
status: needs_design
priority: 1
rank: 2
estimate: 2
branch:
summary: "PostHog *is* already wired into the deployed apps (per repo memory + product-vision pointers), but our data agents — `/validate-candidate`, `/logs`, the qa-agent successor — have **no programmatic way to query it**. Today every UI/perf claim ends up 🟡 INDIRECT in validation because Loki only sees `/api/internal/*` routes; page renders, RSC fetches, NextAuth, client errors, and Web Vitals (LCP/FCP/INP) all live exclusively in PostHog. Add a thin agent-side query path (PostHog query API + a `scripts/posthog-query.sh` shell helper, mirroring `scripts/loki-query.sh`) so agents can answer 'did my own click land at the deployed SHA' without a human."
outcome: "After this PR: (1) `scripts/posthog-query.sh '<HogQL>'` works against PostHog Cloud the same way `scripts/loki-query.sh` works against Loki — reads `POSTHOG_PROJECT_ID` + `POSTHOG_API_KEY` from a gitignored env file, returns raw JSON. (2) `/validate-candidate` skill updated to query PostHog for client-side traces (page-view, web-vitals, error events tagged with the deployed buildSha) when the impacted surface is a UI page. (3) Same shell helper available to `/logs` skill so debugging client-side perf regressions is one query. (4) Documentation: `docs/guides/posthog-agent-query.md` mirrors `docs/guides/agent-api-validation.md` shape."
spec_refs:
assignees: derekg1729
credit:
project:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [observability, agent-tooling, posthog, validation, frontend, perf]
external_refs:
  - work/items/task.0403.operator-loading-error-boundaries.md
  - work/items/task.0408.port-loading-error-boundaries-other-nodes.md
  - work/items/task.0405.per-node-skeleton-accuracy-matrix.md
---

## Problem

PostHog is deployed (per repo memory: "Cloud free tier for prod,
self-hosted for dev only"). Apps emit events. **But our data agents
can't read those events.**

Concrete failure case observed during task.0403 validation:

> User clicks around `test.cognidao.org` to validate the loading.tsx
> skeleton paint. Agent queries Loki to see those clicks. Result:
> 88× `meta.readyz`, 0× `/dashboard`, 0× `/chat`, 0× signin.
> Operator's Pino logger only emits on `/api/internal/*` and
> `/api/v1/*`. Page renders, NextAuth, RSC, client errors, Web Vitals
> all live exclusively in PostHog — invisible to the agent. Validation
> verdict drops to 🟡 INDIRECT, with the user as the only person who
> can confirm the perf claim.

Every UI/perf PR hits this. The skeleton-accuracy matrix (task.0405)
will hit this. The qa-agent (task.0309) will hit this. Without
programmatic PostHog access, "the agent confirmed the perf claim"
is **structurally impossible** for any client-perceptible feature.

The fix is **not** wiring PostHog into the apps — that's done. The fix
is giving the agent the same kind of read access we already have for
Grafana/Loki.

## Design

### Outcome

By analogy with `scripts/loki-query.sh` + grafana MCP:

1. **`scripts/posthog-query.sh '<HogQL>' [days_back] [limit]`** —
   shell helper, no MCP dependency. Reads `POSTHOG_PROJECT_ID` +
   `POSTHOG_API_KEY` from env (or auto-sourced `.env.canary` /
   `.env.local`). POSTs to `<host>/api/projects/<id>/query/`
   with HogQL, returns raw JSON on stdout.

2. **`/validate-candidate` skill update** — for `ui-page` surfaces,
   add a tier-1 PostHog query alongside the existing Loki tier-1.
   The query is keyed by `properties.cogni_build_sha` (which the
   client SDK is presumed to tag — verify, and if absent, instrument
   it as part of this PR).

3. **`/logs` skill update** — add a "PostHog" section parallel to
   the existing "Loki" section so debugging UI bugs is symmetric
   with debugging API bugs.

4. **`docs/guides/posthog-agent-query.md`** — mirrors
   `docs/guides/agent-api-validation.md` shape. Quickstart, common
   HogQL recipes (page-view at SHA, web-vitals percentiles,
   error-by-digest, signin-funnel), env-var setup.

### Open questions to resolve in design

- **Does the client SDK currently tag `cogni_build_sha` on every
  event?** If not, instrumenting that is part of this PR's scope —
  it's the PostHog-side analog of `/version.buildSha`.
- **Is there a single shared PostHog project across nodes, or one
  per node?** Decision affects the query-helper's project-id env
  var (single `POSTHOG_PROJECT_ID` vs `POSTHOG_PROJECT_ID_<NODE>`).
- **Human action needed?** The user noted: "we need (human action to
  assist agent setup..? maybe.)". Likely: someone with PostHog admin
  needs to mint a personal API key (or service account) scoped to
  read-only `query` permission. Document the steps; do not commit
  the token.

### Reuse

- `scripts/loki-query.sh` — copy its shape (env auto-source,
  raw-JSON-on-stdout, no jq dependency at the helper layer).
- `docs/guides/candidate-auth-bootstrap.md` — same "human-action
  required to mint a credential" pattern; structure the human-action
  doc the same way.

### Out of scope

- Wiring PostHog into the apps if it's already wired (verify;
  document either way).
- Self-hosted PostHog for dev — a separate question; the spike data
  (per repo memory) suggests Cloud free is sufficient v0.
- Building a PostHog → Loki bridge — overkill for the MVP gap.

## Todos

- [ ] **Audit current state** — confirm PostHog is wired in deployed
      apps; capture which events fire (`$pageview`, `$web_vitals`,
      `$exception`, custom auth events?). If `cogni_build_sha`
      isn't tagged on events, instrument it.
- [ ] **Mint API key** — human action: mint a read-only personal
      API key in PostHog; store it in `.env.canary` next to the
      Grafana token.
- [ ] **Write `scripts/posthog-query.sh`** — env auto-source, HogQL
      POST, raw JSON on stdout.
- [ ] **Write `docs/guides/posthog-agent-query.md`** — quickstart +
      HogQL recipes (page-view, web-vitals percentiles, error-by-
      digest, signin-funnel).
- [ ] **Update `.claude/skills/validate-candidate/SKILL.md`** — add
      tier-1 PostHog query for `ui-page` surfaces alongside Loki.
- [ ] **Update `.claude/skills/logs/SKILL.md`** — add PostHog section
      parallel to Loki.
- [ ] **Smoke test** — query for own click events at a known build
      SHA; confirm round-trip works.

## Validation

```
exercise:
  1. As an agent, click a route on candidate-a-operator using the
     captured Playwright storageState (or curl with session cookie).
  2. Run scripts/posthog-query.sh "SELECT timestamp, event,
     properties.\$current_url, properties.cogni_build_sha
     FROM events
     WHERE timestamp > now() - INTERVAL 5 MINUTE
       AND properties.cogni_build_sha = '<head-sha>'
     ORDER BY timestamp DESC
     LIMIT 20"
  3. Confirm the agent's own pageview appears in the result, tagged
     with the deployed SHA. Acceptance criterion = the same
     "read your own request back" loop we already have for Loki.

  4. Re-run validate-candidate on a UI-only PR (e.g. task.0405's
     skeleton-accuracy work). Confirm the LOKI column on UI-page rows
     can now be 🟢 (PostHog tier-1) instead of always 🟡 (Loki tier-4
     ambient traffic).

observability:
  This task's own observability IS the deliverable — once it lands,
  every future client-perceptible PR can close its own deploy_verified
  loop without a human.
```

## Closes / Relates

- Unblocks: task.0405 verdict-grading (without PostHog the matrix is
  Derek-only).
- Unblocks: task.0309 (qa-agent E2E validation graph).
- Related: future task to add Web Vitals dashboard in Grafana
  Cloud's PostHog datasource integration (if such a thing exists in
  Grafana — to avoid agents needing to hit two backends).

## PR / Links

- PR: TBD
