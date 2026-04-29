---
id: bug.0421
type: bug
title: "Production mobile SIWE on cognidao.org broken; root cause unknown — WalletConnect (Reown) is an opaque, un-AI-reachable third party"
status: needs_triage
priority: 0
rank: 1
estimate: 2
summary: "Mobile MetaMask Sign-In-With-Ethereum on `https://cognidao.org` (operator prod) stopped working today. The only shared change today was adding `https://*.cognidao.org` to the Reown WalletConnect Cloud allowlist (per my recommendation, while debugging mobile SIWE on candidate-a). All code changes were on an unmerged PR branch (`feat/coinbase-smart-wallet-siwe`, PR #1119) flighted to candidate-a only — no prod deploy occurred. Root cause is not yet established because we have no captured DevTools console / WC verify response from a failed prod tap. The bigger systemic finding: Reown / WalletConnect Cloud is a mission-critical dependency for our entire SIWE flow (every node, every env, prod included) and we have ZERO automated reachability into it — no Loki signal, no health probe, no AI-callable diagnostic, no MCP tool, no synthetic monitor. A change to that dashboard can break prod sign-in, and we'd find out only when a human reports it."
outcome: "Two-part: (a) restore prod mobile SIWE on `cognidao.org` and capture a clean repro + fix in this bug. (b) Close the observability gap on Reown / WalletConnect Cloud: at minimum a synthetic check that posts a known origin to `verify.walletconnect.org` and alerts on rejection, ideally a typed wrapper / MCP tool that lets an AI list/diff the project's allowlist + recent rejection events. Acceptance: a rolled-back or known-bad Reown config produces a Loki line within 5 minutes; an agent debugging a future SIWE regression has at least one diagnostic command to run against the WC Cloud project state without a human opening the dashboard."
spec_refs:
  - authentication
assignees: [derekg1729]
project: proj.security-hardening
created: 2026-04-29
updated: 2026-04-29
labels:
  [
    auth,
    siwe,
    walletconnect,
    reown,
    mobile,
    prod,
    observability,
    third-party-blackbox,
    p0,
  ]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/1119
  - work/items/bug.0369.reown-walletconnect-origin-allowlist-per-env.md
  - work/items/task.0402.scope-wallet-provider-restore-ssr.md
---

# bug.0421 — Production mobile SIWE broken; WalletConnect (Reown) is an opaque dependency

## Background

Started the day trying to make mobile SIWE actually work on `poly-test.cognidao.org` (candidate-a). Mobile sign-in had been broken across the fleet since `task.0402` dropped RainbowKit's `getDefaultConfig` (no `rkDetails` metadata → mobile modal renders empty). The one exception was operator prod `cognidao.org`, which Derek had successfully signed into in the past.

Two changes happened today:

1. **Code (PR #1119, branch `feat/coinbase-smart-wallet-siwe`, unmerged, flighted to candidate-a only):**
   - First commit added `coinbaseWallet` connector + WalletConnect `metadata.redirect` to the bare `wagmi.config.ts`. (Later proven ineffective without `rkDetails`.)
   - Second commit shipped the canonical RainbowKit v2 split-config: kept `wagmi.config.ts` SSR-safe for `cookieToInitialState`; added new `wagmi.config.client.ts` per node using `connectorsForWallets` from `@rainbow-me/rainbowkit/wallets` with curated roster (MetaMask, Coinbase Wallet, WalletConnect, Rainbow, Injected); pointed `<WagmiProvider>` in each `providers.client.tsx` at the new client config.
   - Files touched: `nodes/{node-template,operator,poly,resy}/app/src/shared/web3/wagmi.config{,.client}.ts` (8 files) + `nodes/*/app/src/app/providers.client.tsx` (4 files).

2. **Reown WalletConnect Cloud allowlist (shared across all envs — dev/candidate-a/preview/prod):**
   - Added `https://*.cognidao.org` to project `a978f928157e183391e9e1e8c3aef376`.
   - Pre-existing entry `cognidao.org` (apex) was NOT removed — Derek confirms both are present.

Code never reached prod. Allowlist change DID reach prod (Reown is a single shared project across envs).

## Symptoms

- **Prod (`cognidao.org`) — mobile SIWE that worked yesterday is broken today.** Tap MetaMask in the wallet picker → no completion. (No DevTools console capture yet.)
- **Candidate-a (`poly-test.cognidao.org`) — split-config refactor visibly improved the modal**: MetaMask / Coinbase / WalletConnect / Rainbow tiles now render (was empty before). But tapping MetaMask deep-links to MetaMask app → silence (no connect or sign prompt). Whether this is the same root cause as the prod regression is unknown.

## Hypotheses (all unverified — see "What we have NOT done")

| #   | Hypothesis                                                                                                              | How to disprove                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| H1  | Adding `*.cognidao.org` to Reown silently disabled or shadowed the apex `cognidao.org` entry                            | Remove the wildcard; re-test prod                                                                     |
| H2  | Reown's verify endpoint had a propagation issue / rate limit today                                                      | Check Reown dashboard activity log; capture WC verify response from a failed tap                      |
| H3  | MetaMask Mobile app updated overnight and broke its WC v2 deep-link handler (industry-wide pattern; not Cogni-specific) | Capture iOS MetaMask version; check MetaMask GitHub issues                                            |
| H4  | Some other PR merged to main today touched the operator auth path                                                       | Diff `main` against yesterday — none of the merged PRs (#1120, #1124, #1123) touched auth from titles |
| H5  | Prod was already broken yesterday; Derek noticed today                                                                  | Check Loki for last successful operator SIWE event                                                    |

## What we have NOT done (the actual next move)

1. **Open prod `cognidao.org` in desktop Chrome, DevTools → Console open, tap Connect → MetaMask. Capture the WC error.** That single line tells us whether it's an allowlist issue (`origin not allowed` / 403 from `verify.walletconnect.org`), a MetaMask deep-link issue, or something else.
2. Screenshot the Reown dashboard Domains section to confirm the exact strings entered (Reown is strict on protocol prefix, trailing slash, casing).
3. `curl -s https://verify.walletconnect.org/v2/originverify -H 'Content-Type: application/json' -d '{"projectId":"...","origin":"https://cognidao.org"}'` — does Reown's verify endpoint say yes or no for the apex right now?

## The bigger problem this exposes — RED FLAG

Reown / WalletConnect Cloud is **the single most opaque mission-critical third party in our stack**:

- **Every SIWE on every env (prod included) flows through it.** A bad Reown config = no sign-ins = no users = no revenue.
- **An AI agent debugging a SIWE failure has zero callable diagnostic surface.** No MCP tool. No CLI. No API key in our env. No log scraper. The `verify.walletconnect.org` endpoint has no documented "is this origin allowed" probe — only the implicit "did the wallet ever pop up after the user tapped, or not." Failures are silent on the dApp side and the wallet side.
- **No Loki signal whatsoever from Reown.** A SIWE attempt that gets rejected at WC verify produces nothing in our logs; the user just sees a stuck modal.
- **The dashboard is human-only.** Adding/removing/diffing allowlist entries is a click flow at `cloud.reown.com`. No GitOps, no audit trail in our repo, no way for an AI to tell what state the project is in.
- **Today's incident proves the blast radius.** A 30-second dashboard click — recommended by an AI assistant trying to fix mobile sign-in — may have broken prod sign-in for every user. The AI cannot now self-diagnose that (no observability), cannot self-revert (no API), and cannot even confirm whether the change is the cause (no probe). Derek had to be the one to notice, the one to debug, and is the one who has to fix.

For a project whose mission depends on autonomous agents shipping to deploy_verified, having a critical-path third party with **zero AI reachability** is a structural gap. We invest heavily in Loki / Grafana / structured adapters for our OWN code; the wallet auth layer — which gates EVERY user interaction — is a black box.

## Proposed work (acceptance criteria for this bug)

1. **Restore prod.** Capture the actual root cause via DevTools console (or an `originverify` probe) and apply the targeted fix. If H1 is right, removing the wildcard restores prod; document the apex-vs-wildcard gotcha in `docs/spec/authentication.md`.

2. **Build minimum viable AI reachability for Reown / WalletConnect Cloud:**
   - **a.** A synthetic check (Loki-fed cron or k8s liveness probe) that hits `verify.walletconnect.org/v2/originverify` for each known prod origin every 5 minutes and emits `event=walletconnect.verify.{ok,reject}` to Loki. Alert on any reject.
   - **b.** A typed wrapper / MCP tool (call it `wc_admin` or `reown_admin`) wrapping the Reown Cloud REST API that exposes at minimum: `list_allowlist(projectId)`, `add_allowlist(projectId, origin)`, `remove_allowlist(projectId, origin)`, `recent_rejections(projectId, since)`. Requires a Reown API token in env (currently we only have the public projectId).
   - **c.** Mirror the allowlist into a versioned config in this repo (e.g. `infra/walletconnect/allowlist.yaml`) and have the wrapper assert the dashboard matches. Drift fails CI.

3. **Document the SIWE failure-mode tree** in `docs/guides/wallet-auth-debugging.md`. What the symptom looks like at each layer (browser console, MetaMask app, WC verify, Reown dashboard, NextAuth callback) and what to check first.

## Validation

exercise: from a desktop browser, capture the actual WC error from a failed prod tap (`https://cognidao.org` → Connect → MetaMask) — DevTools console + Reown dashboard activity log. Then test the targeted fix on prod from Derek's iPhone: Connect → MetaMask → SIWE completes → land signed in. After the observability piece ships, verify the synthetic probe emits `event=walletconnect.verify.ok` to Loki for the operator origin and an injected bad-origin emits `event=walletconnect.verify.reject` within 5 minutes; the `reown_admin` tool returns the project's current allowlist; `infra/walletconnect/allowlist.yaml` matches the dashboard and CI fails on intentional drift.

observability: NextAuth `signin` event in operator prod pod logs at the deployed SHA tied to Derek's wallet address proves prod is restored. New `event=walletconnect.verify.{ok,reject}` event class is queryable per-origin per-projectId from Loki. The failure-mode runbook (§3) cross-references the existing `auth.siwe.verify` and `next-auth.signin` events so an agent debugging a future SIWE regression can self-trace end-to-end without opening the Reown dashboard.

## Files / branches / refs

- Worktree: `/Users/derek/dev/cogni-template-coinbase-siwe`
- Branch: `feat/coinbase-smart-wallet-siwe`
- PR: https://github.com/Cogni-DAO/node-template/pull/1119
- Commits on branch: `8813980c2`, `db7fca960`
- Reown projectId: `a978f928157e183391e9e1e8c3aef376` (env: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`)
- Operator prod URL: `https://cognidao.org`
- Operator candidate-a URL: `https://test.cognidao.org`
- Related: `bug.0369` (Reown allowlist per-env was already an unresolved gap), `task.0402` (the change that started the mobile-modal problem)
