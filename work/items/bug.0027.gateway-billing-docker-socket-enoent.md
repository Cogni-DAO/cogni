---
id: bug.0027
type: bug
title: "Gateway billing fails in production — Docker socket ENOENT crashes all OpenClaw runs"
status: done
priority: 0
estimate: 2
summary: "ProxyBillingReader uses dockerode to read billing logs via docker exec, but the production app container does not mount /var/run/docker.sock. All sandbox:openclaw executions fail with Stream finalization failed: internal."
outcome: "Gateway billing reads from shared volume instead of docker exec; long-term replacement via LiteLLM callback spec drafted."
spec_refs: billing-ingest-spec, billing-sandbox
assignees: derekg1729
credit:
project: proj.payments-enhancements
branch: fix/openclaw-billing-hack
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [billing, production, p0]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# bug.0027 — Gateway billing Docker socket ENOENT

## Problem

Production `sandbox:openclaw` chat and scheduled runs fail 100% of the time since Feb 10 ~20:31 UTC. Error chain:

1. `ProxyBillingReader` → dockerode → `connect ENOENT /var/run/docker.sock`
2. → "Billing failed: no proxy billing entries from gateway"
3. → "ASSISTANT_FINAL_REQUIRED violated"
4. → UI: "Stream finalization failed: internal"

**Root cause**: The app container in production does not mount `/var/run/docker.sock`. In local dev (`pnpm dev:stack`), the app runs on the host where the socket exists natively, masking the issue.

## Fix (implemented on branch)

**Bridge fix**: Replace docker exec billing reads with a shared Docker volume between the nginx proxy and the app.

- `8cbebdfc` — Rewrite `ProxyBillingReader` to use `fs.open/stat/read` on JSONL audit log via shared volume
- `568b391e` — Make gateway billing misconfiguration a hard error (throw instead of warn-and-continue)

**Long-term fix**: `docs/spec/billing-ingest.md` — LiteLLM `success_callback` webhook replaces all log scraping.

## Validation

- [ ] Deploy bridge fix to production, confirm `sandbox:openclaw` chat completes
- [ ] Verify charge_receipts written for gateway runs
- [ ] `langgraph:poet` scheduled runs unaffected (uses InProc path)

## PR / Links

- Handoff: [handoff](../handoffs/bug.0027.handoff.md)
