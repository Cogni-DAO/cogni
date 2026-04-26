---
id: bug.0369
type: bug
title: "Reown/WalletConnect origin allowlist missing for poly-test (and no sync workflow across node × env matrix)"
status: needs_triage
priority: 1
rank: 1
estimate: 2
created: 2026-04-24
updated: 2026-04-24
summary: "poly-test.cognidao.org logs `Origin https://poly-test.cognidao.org not found on Allowlist - update configuration on cloud.reown.com` on every wallet-connect attempt, a 403 from the Reown project config endpoint. Would break UI wallet-connect for any user hitting poly-test. Broader issue: we have no standardized ops workflow for keeping the Reown/WalletConnect project allowlist in sync with the node × env DNS matrix (poly, operator, resy × candidate-a, preview, production). Each new env or new node is a silent manual step — the same class of problem the dns-ops skill solves for Cloudflare, but for Reown."
outcome: "(a) poly-test.cognidao.org added to the Reown project allowlist — immediate unblock. (b) A `reown-ops` primitive (skill or script) that enumerates the expected origins from the node × env matrix and reconciles the Reown project allowlist, mirroring how `dns-ops` handles Cloudflare. (c) Guide doc anchoring the source-of-truth origin list."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
initiative:
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
labels: [walletconnect, reown, wallet, dns-ops, infra]
external_refs:
  - "https://cloud.reown.com"
---

# bug.0369 — Reown/WalletConnect Origin Allowlist Missing per Env

## Evidence

Captured during candidate-auth bootstrap testing against `poly-test.cognidao.org` on 2026-04-24 (PR #1038):

```
[page.error] Failed to load resource: the server responded with a status of 403 ()
[page.error] Origin https://poly-test.cognidao.org not found on Allowlist - update configuration on cloud.reown.com
```

Repeats on every page load that initializes wagmi/Reown (`nodes/poly/app/src/shared/web3/wagmi.config.ts` → `projectId: clientEnv().NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).

## Immediate impact

- Any user attempting UI wallet-connect from poly-test.cognidao.org sees the Reown SDK reject the origin. SIWE-via-MetaMask signin happens to still work because it doesn't depend on the Reown config endpoint — but any flow that does (e.g., the WalletConnect v2 pairing for mobile wallets) is broken.
- Same failure mode is likely latent on every other candidate/preview origin that isn't in the Reown project allowlist today.

## Systemic problem

This is the same class of problem `dns-ops` solves for Cloudflare: there's a node × env matrix of hostnames, and every external system that needs to know about those hostnames drifts out of sync with the matrix unless the sync is codified.

| Node     | candidate-a            | preview                   | production        |
| -------- | ---------------------- | ------------------------- | ----------------- |
| operator | test.cognidao.org      | preview.cognidao.org      | cognidao.org      |
| poly     | poly-test.cognidao.org | poly-preview.cognidao.org | poly.cognidao.org |
| resy     | resy-test.cognidao.org | resy-preview.cognidao.org | resy.cognidao.org |

Each one of those needs to be on the Reown project allowlist. Today the allowlist is hand-curated via the Reown dashboard with no checked-in source of truth, so:

- New nodes ship without their origins added (silent UI-wallet regression).
- New envs (e.g., spinning up a second candidate slot) require a manual Reown step.
- No test / CI gate catches the drift.

## Fix scope

**Phase 1 — immediate unblock (this bug):**

- Add `https://poly-test.cognidao.org` (and any other known-missing origins) to the Reown project allowlist manually.
- Document the current Reown `projectId` and allowlist source-of-truth in `docs/guides/reown-ops.md`.

**Phase 2 — primitive (follow-up, out of scope for this bug):**

- `reown-ops` skill / script, parallel to `dns-ops`, that:
  - Reads the expected origin matrix from the same place that drives `dns-ops` (node × env → hostname map).
  - Calls the Reown Cloud API to reconcile the project allowlist.
  - Fails CI when a hostname exists in DNS but not in the Reown allowlist.

## Validation

- [ ] poly-test.cognidao.org added to Reown project allowlist
- [ ] Reload `https://poly-test.cognidao.org`, open DevTools console — no more `Origin ... not found on Allowlist` errors
- [ ] Every env hostname in the node × env matrix confirmed present in the Reown allowlist (one-time audit)
- [ ] `docs/guides/reown-ops.md` authored with allowlist audit procedure

## References

- PR #1038 — candidate-auth bootstrap; where this was surfaced
- `docs/guides/candidate-auth-bootstrap.md` — the workflow that exposed it
- `dns-ops` skill — template for the reconciliation primitive
- `nodes/poly/app/src/shared/web3/wagmi.config.ts` — where the projectId is read
