---
id: proj.security-hardening
type: project
primary_charter:
title: Security Hardening — SOC2-Aligned Production Access Controls
state: Active
priority: 3
estimate: 8
summary: Close the SOC2 control gaps exposed by the bug.0403 incident response — direct production SSH + superuser psql + chat-text authorization for financial-data mutations bypassed every meaningful access control. Establish maker-checker, app-mediated operator actions, immutable audit, and short-lived credentials so prod data writes by a single agent become structurally impossible.
outcome: No human or agent can mutate production financial-state data via direct SSH + raw SQL. All operator actions (cap bumps, lifecycle reconciliation, grant edits) flow through authenticated admin endpoints with maker-checker, recorded in an immutable audit log, gated by short-lived signed credentials. SOC2 CC6.1 / CC6.6 / CC8.1 controls have written runbooks with evidence-collection steps.
assignees: []
created: 2026-04-27
updated: 2026-04-27
labels: [security, soc2, compliance, access-control, audit, operator]
---

# Security Hardening — SOC2-Aligned Production Access Controls

## Goal

No human or agent can mutate production financial-state data (`poly_wallet_grants`, `poly_redeem_jobs`, future `operator_*` tables) via direct SSH + raw SQL. Every operator action flows through an authenticated admin endpoint with maker-checker, recorded in an immutable audit log, gated by short-lived signed credentials. SOC2 CC6.1 / CC6.6 / CC8.1 controls have written runbooks with evidence-collection steps that pass an external audit.

## Constraints

- **Don't break the experiment-friendly slot.** `candidate-a` write-mode SSH is intentionally permitted for 5-minute experiments per the `devops-expert` skill rules; this project narrows the prod-only gap, not the candidate-a workflow.
- **Don't reintroduce app-level controls that already exist.** RLS, `app_user`/`app_service` role split, and Zod contract validation are working; this project removes the superuser-shell bypass, not the existing controls.
- **One-developer team reality.** Maker-checker has to be implementable when there's only one human reviewer — the "checker" can be an automated pre-condition (e.g., SHA-pinned chain-truth verification) for low-risk classes, with human-checker reserved for high-risk classes.

## Motivating Incident

During bug.0403 response (2026-04-27), one Claude Code agent autonomously:

1. Read the prod VM SSH private key from `.local/production-vm-key` on a developer laptop.
2. Connected to the prod VM as `root` via SSH.
3. Ran `docker exec` to get a `psql -U postgres` superuser shell, **bypassing RLS, app-level RBAC, and the `app_user` role boundaries**.
4. Executed `UPDATE poly_wallet_grants` to bump cap limits on a financial-state table ($4/$30 → $5/$60).
5. Executed `UPDATE poly_redeem_jobs` to reconcile 7 abandoned redemption jobs to `confirmed` — mutating financial settlement state.

Authorization for both writes was a **single chat message** ("Yes, I authorize you to run this") with no out-of-band confirmation, no MFA, no second-party approval, no change ticket, no automated rollback plan. The action was correct and the data was good — but the **control plane allowed any future agent (or compromised laptop) to do exactly the same with no friction**.

This is a structural SOC2 fail, not a policy fail.

## SOC2 Control Gap Map

| TSC Control                                                                               | Gap Observed                                                                                                                                | Priority |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **CC6.1** Logical access — authentication & authorization                                 | Long-lived RSA key on developer disk, root SSH login, no MFA at the SSH/DB boundary                                                         | 1        |
| **CC6.2** Identity verification before credentials issued                                 | No formal credential issuance flow for prod access; key was placed by `provision-test-vm.sh`                                                | 2        |
| **CC6.3** Access modifications require approval; periodic review                          | No quarterly access review; revocation of prod SSH access has no documented runbook                                                         | 2        |
| **CC6.6** Restrict access to confidential information                                     | `psql -U postgres` bypasses RLS that the app stack carefully enforces; no separation of duties between app developer and prod-data operator | 1        |
| **CC7.2** System monitoring — anomaly detection                                           | No alert fires when `app_service` / `postgres` superuser issues an UPDATE on `poly_wallet_grants` or `poly_redeem_jobs`                     | 2        |
| **CC8.1** Change management — production changes require approval, testing, documentation | Cap bump + reconciliation had no change ticket, no rollback plan, no peer signoff. Chat-text "yes" is not auditable approval                | 1        |
| **A1.2** Availability — no immutable audit retention for prod sessions                    | SSH session output landed in a chat transcript; not shipped to a SIEM, not signed, not retained per a written policy                        | 3        |

## Roadmap

### Crawl (P0) — Stop the bleed

**Goal:** make today's exact failure mode impossible without removing operator capability.

| Deliverable                                                                                                                 | Notes                                                                                       | Est | Work Item |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --- | --------- |
| Revoke direct prod SSH from developer laptops; rotate `production-vm-key`                                                   | Move the key off `.local/`; only `candidate-flight-infra.yml` workflow + bastion has it     | 2   | —         |
| Bastion / jump host with TTY session recording → immutable storage                                                          | Auth via SSH cert (CA-signed, 1h TTL, MFA-gated), `script(1)` logs shipped to a WORM bucket | 3   | —         |
| Named operator DB role with `GRANT UPDATE` only on operator-mutable tables (`poly_wallet_grants`, `poly_redeem_jobs`, etc.) | No more `psql -U postgres` for operator actions                                             | 2   | —         |

### Walk (P1) — App-mediated operator actions

**Goal:** every prod data mutation goes through an authenticated admin endpoint with maker-checker, not raw SQL.

| Deliverable                                                                                                                                                                                           | Notes                                                                       | Est | Work Item |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --- | --------- |
| `POST /api/v1/admin/poly/wallet/grants/:id/cap` — Zod-validated, audit-logged, requires admin api key                                                                                                 | Replaces the `UPDATE poly_wallet_grants` SSH path                           | 3   | —         |
| `POST /api/v1/admin/poly/redeem/reconcile` — accepts a list of `(funder, conditionId)` and a target status, validates against on-chain truth via the same `getLogs` path the reaper uses, then writes | Replaces the bookkeeping-fix SSH path                                       | 3   | —         |
| Maker-checker enforcement: every admin write requires a second `apiKey` to countersign within N minutes, or it auto-expires                                                                           | Pluggable; can start as a feature flag and enforce per-endpoint             | 3   | —         |
| Audit-log table `operator_audit_log` (append-only, partitioned, retained 1y) populated by all admin endpoints                                                                                         | Includes maker, checker, redacted payload, IP, user-agent, prior-state hash | 2   | —         |

### Run (P2) — SOC2 evidence + cadence

**Goal:** the controls have written runbooks, periodic-review evidence, and pass an external audit.

| Deliverable                                                                  | Notes                                                                                   | Est | Work Item   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --- | ----------- | ------------------------------------- | --- | --- |
| Quarterly access review runbook + evidence template                          | Who has prod SSH, prod DB, admin api keys; signed by Derek each quarter                 | 1   | —           |
| Change-management runbook for prod data writes                               | Required template: ticket → approval → execution → evidence → close                     | 1   | —           |
| Data classification labels on every table in `poly_*` / `operator_*` schemas | `confidentiality_tier: financial                                                        | pii | operational | public`; informs alerting + retention | 2   | —   |
| SIEM ingestion of pg_audit + bastion session logs + admin endpoint logs      | Single pane; alert rules for `psql -U postgres` writes (should be zero in steady-state) | 3   | —           |
| Annual SOC2 readiness self-assessment                                        | Tabletop walkthrough of CC6._ / CC7._ / CC8.\* against the runbooks                     | 2   | —           |

## Dependencies

- `proj.database-ops` — backup/restore + connection pooling complete the data-tier story; SOC2 evidence for restore tests integrates here.
- `proj.cicd-services-gitops` — bastion + signed SSH cert issuance fits the GitOps + workflow-dispatch model already used for `candidate-flight-infra`.
- Pre-existing `.local/{env}-vm-key` onboarding pattern (`docs/guides/multi-node-deploy.md`) — Crawl row 1 narrows it to non-prod only.

## As-Built Specs

None yet — every Walk/Run deliverable will land its own spec under `docs/spec/security/` as it ships. Tracking issues to be linked here as the project advances.

## Design Notes

- **Out of scope vs `proj.poly-web3-security-hardening`** — that project covers chain-side write safety (pre-flight checks, post-flight verification, anvil-fork regression). This project covers operator-side access control. The two intersect at "who can call admin endpoints that trigger on-chain writes" but the disciplines are different.
- **App-level RLS is already a strong control** — this project does not weaken it. The gap is that a superuser shell BYPASSES RLS; the fix is to remove the superuser shell from the operator workflow, not to redo RLS.
- **Maker-checker as feature flag, not big-bang** — Walk row 3 is enforce-per-endpoint so the rollout can prove value on cap-bump first before extending to redeem-reconcile and beyond.
- **Audit log is the truth, not a logging concern** — `operator_audit_log` is a domain entity (append-only ledger) populated synchronously by every admin endpoint, not a side-channel from an APM. Retention + integrity guarantees come from DB constraints, not from app correctness.
