---
id: bug.0327
type: bug
title: No client-side crash telemetry — node apps can serve broken UX to users and we don't know
status: needs_triage
priority: 1
rank: 5
estimate: 3
summary: A client-side runtime regression on candidate-a (PR #918 shipped a `pnpm add @tremor/react` / `pnpm remove` sequence that bumped two transitive deps — `use-sync-external-store` 1.4→1.6 and `ws` 7→8 — breaking the poly-app client bundle so every URL rendered Chrome's "This page couldn't load") went completely undetected by our telemetry. Pod was Healthy. Pino/Loki saw zero errors. `/readyz` was 200. Candidate-flight verify-buildSha passed. The only signal we got was the user visually loading the page and telling us. We have zero browser-side crash capture wired — no PostHog JS `captureException`, no `global-error.tsx` / `error.tsx` boundaries, no Next.js `instrumentation-client.ts` `onRequestError` hook, no synthetic probe in `candidate-flight.yml` that renders /dashboard in a headless browser and asserts no `__next_error__` in the DOM. **Any one of those five layers would have caught it instantly.** Related: we have no e2e test suite that exercises real pages post-deploy either.
outcome: Client-side crashes + SSR React throws on any node app are captured and visible in PostHog with stack trace + URL + user + session replay within seconds of the first affected page load, AND `candidate-flight.yml` fails red on a flight that ships a broken client bundle (headless synthetic probe against `/` and `/dashboard` post-Argo-reconcile, asserting absence of `id="__next_error__"` and verifying expected card/component markers), AND a PostHog alerting rule pings a channel on any non-zero `$exception` count in a rolling 5-minute window on candidate + prod environments.
spec_refs:
  - ci-cd-spec
  - posthog
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels: [cicd, flight, observability, posthog, telemetry, frontend]
external_refs:
  - work/items/task.0315.poly-copy-trade-prototype.md
  - work/handoffs/task.0315.dashboard-integration.handoff.md
---

# No client-side crash telemetry — node apps can serve broken UX to users and we don't know

## How this surfaced

PR #918 (task.0315 dashboard) was flighted to candidate-a at SHA `f973018`. User-facing symptom: every `https://poly-test.cognidao.org/*` URL rendered Chrome's "This page couldn't load" error page. Other nodes were fine.

Observability state during the outage:

| Signal                                                   | Reported         | Reality                                         |
| -------------------------------------------------------- | ---------------- | ----------------------------------------------- |
| `/readyz`                                                | 200, version OK  | —                                               |
| `/livez`                                                 | 200              | —                                               |
| `kubectl get pods`                                       | Running 1/1      | —                                               |
| `candidate-flight.yml` verify-buildSha                   | ✅ pass          | —                                               |
| Loki `{namespace=cogni-candidate-a,app=poly}` level ≥ 40 | zero matches     | **client bundle was crashing on every page**    |
| Curl of `/dashboard`                                     | 200, 14 KB HTML  | (contained legitimate `redirect()` RSC payload) |
| PostHog `$exception` count                               | 0                | **every real user page load was throwing**      |
| Synthetic probe                                          | n/a — none exist | —                                               |

Diagnosis took ~40 minutes of ghost-chasing (browser cache theories, service worker theories, CSP theories) before a headless-Chrome dump-dom showed `<html id="__next_error__">` — then another 15 minutes to find that the transitive-dep shift in `pnpm-lock.yaml` was the actual culprit.

Root cause of the dep shift: `pnpm add @tremor/react` + `pnpm remove @tremor/react` inside `nodes/poly/app` during a design-exploration session. pnpm re-solved the whole importer, nudging `use-sync-external-store` from 1.4.0 to 1.6.0 and `ws` from 7.5.10 to 8.19.0 (both sit under zustand + assistant-ui + wagmi — every client-side runtime dep). Fixed in commit `1bb07d22d` by reverting `pnpm-lock.yaml` + `nodes/poly/app/package.json` verbatim to the last-deployed working SHA.

**But the dep-shift is the boring root cause. The interesting one is: nothing in our stack noticed a production regression for a production user until the user manually reported it.**

## Why this is P1

The poly node is running live mirror orders with real USDC. If the operator ever needs to cancel a stuck order, pause the killswitch, or see positions via the UI, and the UI silently doesn't render — we have no way to know we just denied the operator access to live-money controls. We lucked into it this time because the user was piloting; in normal operation they might not log in for hours, by which point a rogue target wallet could have drained the mirror cap.

## What the 0.1% do

Pattern across Vercel, Linear, Stripe Dashboard, GitHub, Notion, Cloudflare Dashboard:

1. **Browser-side error SDK on every page load.** Sentry / PostHog exception autocapture / Datadog RUM / Bugsnag / LogRocket — pick one, they all do the same core thing: catch `window.onerror`, `window.onunhandledrejection`, React error boundaries, and Next.js `onRequestError` hooks, ship stack + release version + user + breadcrumbs + (often) session replay video to a backend indexed by release SHA.
2. **Source maps uploaded per release.** The SDK sends minified stacks; the backend de-minifies via uploaded source maps so you see `OperatorWalletCard.tsx:67` not `chunks/abc.js:1:4823`.
3. **Release-tagged error rates.** Every deploy tags a release. The error dashboard shows "new errors in release vs previous release" on a single chart. One bad deploy → visible spike within minutes. Vercel's own telemetry goes further: they compare error rates across regions / devices / browsers per release and auto-page oncall on a statistically significant spike.
4. **Pre-merge synthetic probes.** CI runs a headless browser against the preview URL, asserts no `__next_error__`, no `console.error`, no failed network requests on the critical paths. Vercel's "Preview Deployments" UI shows a green checkmark only after the synthetic passes.
5. **Post-deploy canary watch.** For 15 minutes after deploy, oncall has a dashboard of "error rate in last 5 min vs baseline". Any sustained spike auto-rolls-back (Cloudflare's "pingboard", Facebook's "Gatekeeper" rollbacks).
6. **User-scoped session replay.** When an error fires, the backend captures the 30s of video leading up to it. Engineers watch the replay instead of guessing from stack traces. Linear + Notion + PostHog Cloud all do this.
7. **Proactive: e2e tests against the deployed URL post-flight.** Not just unit/component — Playwright/Cypress/Puppeteer hitting real deployed pages with real auth + real DB, on the CI critical path. Matches our gap below.

The common shape: **two walls, pre- and post-deploy**. Pre-deploy = synthetics in CI. Post-deploy = RUM + error SDK tailing production. Our repo has neither wall today.

## What we should build (ranked by effort × impact)

### 1. Wire PostHog browser error autocapture — ~1 hour, catches ~80% of cases forever

`POSTHOG_API_KEY` + `POSTHOG_HOST` are already required env vars and `packages/node-shared/src/analytics/` exists for server events. Missing: the client SDK.

Concrete work:

- `pnpm add posthog-js` in each `nodes/*/app`
- New `nodes/*/app/src/app/providers/posthog-client.tsx`:

  ```ts
  "use client";
  import posthog from "posthog-js";
  import { PostHogProvider } from "posthog-js/react";

  if (typeof window !== "undefined" && !posthog.__loaded) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_API_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      capture_exceptions: true,                 // ← the win
      capture_pageview: true,
      session_recording: { maskAllInputs: true },
      before_send: (e) => stripPII(e),
    });
  }

  export function PHProvider({ children }: { children: React.ReactNode }) {
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
  }
  ```

- Wrap in root `providers.client.tsx`
- Expose public env: `NEXT_PUBLIC_POSTHOG_API_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` in `client-env.ts`
- Identity binding: call `posthog.identify(user.id)` in `(app)/layout.tsx` when session resolves
- Release tag: `posthog.register({ release_sha: process.env.NEXT_PUBLIC_BUILD_SHA })` so errors group per deploy

### 2. Next.js App Router error boundaries — ~30 min, hands errors to #1

- `app/global-error.tsx` (catches root-level renderer throws — mandatory for client crashes to hit PostHog)
- `app/(app)/error.tsx` (per-segment boundary; can also call `posthog.captureException(error, { digest })`)
- `src/instrumentation-client.ts` exporting `onRequestError` (Next 15+ official hook for unhandled SSR errors in client components — forwards to PostHog + Pino)

### 3. Synthetic probe in candidate-flight.yml — ~1 hour, fails the flight red

Add a step after "Wait for Argo reconcile" / before posting sticky comment:

```yaml
- name: Synthetic UI probe
  run: |
    for host in test.cognidao.org poly-test.cognidao.org resy-test.cognidao.org; do
      for path in / /dashboard; do
        dom=$(timeout 20 google-chrome --headless --disable-gpu --no-sandbox \
              --virtual-time-budget=6000 --dump-dom "https://$host$path")
        if echo "$dom" | grep -q 'id="__next_error__"'; then
          echo "::error::$host$path rendered __next_error__ — flight fails"
          exit 1
        fi
      done
    done
```

Even with this 10-line version, today's outage would have failed the flight before the "QA window open" sticky comment posted.

### 4. PostHog alerting — ~30 min, pages us on a spike

Create a PostHog Alert: "insight: count of `$exception` events where `environment = candidate-a` OR `environment = production`, group by `release_sha`, threshold > 0 in 5m, notify #incidents".

### 5. E2E Playwright suite — ~1 week, closes the pre-merge wall properly

Related but bigger-scope. `e2e/` already exists (per CLAUDE.md it runs on `pnpm docker:stack`). Extend it with:

- Login flow happy path (per node)
- `/dashboard` renders expected card count
- API contract smoke tests against `/api/v1/poly/wallet/balance`, `/api/v1/poly/copy-trade/{orders,targets}`, `/api/v1/poly/top-wallets`
- Trigger via `candidate-flight.yml` against the flighted URL (not just `docker:stack`)

This one is estimate: 3 (that's just for items 1–4). The e2e wall is a separate work item to file after this one.

## Non-goals

- Sentry / Datadog RUM as separate backends — redundant with PostHog for the free tier level of volume we'll generate.
- Full chaos/failover testing.
- Pre-prod load testing.

## Related

- **Dep-shift guard**: `pnpm install --frozen-lockfile` is already the default on CI, but local workflows that do `pnpm add` or `pnpm remove` during exploration can silently shift transitive deps across the whole importer. Follow-up: husky pre-commit hook that warns when `pnpm-lock.yaml` changes affect more than just the added/removed package's own tree. Out of scope here; file as separate bug if it happens again.
- **task.0315** dashboard work blocked on this becoming green.
- **task.0322 / task.0323** poly mirror hardening — shares the exposure.

## Allowed Changes

- `nodes/*/app/src/app/providers/` — add client-side PostHog wiring
- `nodes/*/app/src/app/global-error.tsx`, `nodes/*/app/src/app/(app)/error.tsx` — new error boundaries
- `nodes/*/app/src/instrumentation-client.ts` — new `onRequestError` hook
- `.github/workflows/candidate-flight.yml` — add synthetic DOM probe step
- `nodes/*/app/src/shared/env/client.ts` — expose `NEXT_PUBLIC_POSTHOG_*`
- PostHog dashboard + alert rules (out-of-repo, capture in runbook)

Not in scope: Sentry/Datadog integration, e2e Playwright suite expansion (separate work item).

## Plan

1. PostHog client SDK + `capture_exceptions: true` per-node.
2. App Router error boundaries (`global-error.tsx`, `(app)/error.tsx`) that forward to PostHog.
3. `instrumentation-client.ts` with `onRequestError`.
4. Synthetic DOM probe step in `candidate-flight.yml` — headless Chrome asserts no `id="__next_error__"` on `/` and `/dashboard` across all three nodes after Argo reconciles.
5. PostHog alerting rule on `$exception` count in candidate + prod.
6. Runbook entry in `docs/guides/observability.md` (or similar) explaining how to triage a client-crash incident.

## Validation

- Deliberately ship a known-bad build to candidate-a (e.g. re-introduce the use-sync-external-store shift in a throwaway branch). Expected: the synthetic-probe step fails red on the flight workflow, AND PostHog `$exception` count alerts within 60s of a real user page load. Then revert.
- With a clean build, confirm `$exception` is zero and synthetic probe passes.
- Unit: error boundaries' `onError` handlers are called with a realistic `digest` + forward to `posthog.captureException` (mock posthog client).
- Contract: synthetic probe step in `candidate-flight.yml` correctly distinguishes `NEXT_REDIRECT` (expected auth-redirect serialization) from a real React throw — do NOT fail the flight on unauthenticated redirects.

## Review Checklist

- [ ] No PII (emails, wallet addresses beyond the operator's, auth tokens) in PostHog event properties.
- [ ] `before_send` filter strips any accidental secret-ish URL fragments.
- [ ] Source map upload wired in the production-image build so stacks are readable.
- [ ] Candidate-flight synthetic probe is short (< 30s total wall time) and doesn't burn free-tier compute.
- [ ] Alert rule targets candidate-a + production only (not preview).

## PR / Links

- Incident conversation: today (2026-04-19) — user reported "This page couldn't load" after flighting #918 at f973018.
- Fix commit that unblocked #918: `1bb07d22d` (poly-mirror-dashboard branch).
- Next.js App Router error handling: https://nextjs.org/docs/app/building-your-application/routing/error-handling
- PostHog `capture_exceptions`: https://posthog.com/docs/error-tracking/installation

## Attribution

derekg1729 — reported, diagnosed.
