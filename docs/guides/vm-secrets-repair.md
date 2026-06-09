---
id: guide.vm-secrets-repair
type: guide
title: VM Secrets Repair — DB Credentials to OpenBao Sole-Source
status: draft
trust: draft
summary: "Per-env runbook to make OpenBao the sole source for a node's pod-facing DB credentials, closing the bug.5002 split-brain. Per-node model (no shared DB bank); env superuser stays bootstrap-only. Gated behind the per-node-role db-provision change."
read_when: "Repairing an existing env whose pod-facing DB credentials still live in VM .env / GitHub Environment secrets; running the falsifying gate for the node-wizard DB-cred lane."
owner: cogni-dev
created: 2026-06-09
spec_refs:
  - ../spec/secrets-management.md
  - ../spec/secrets-classification.md
related:
  - ../design/node-wizard-secret-setting.md
  - ./secrets-rotate.md
---

# VM Secrets Repair — DB Credentials to OpenBao Sole-Source

## Why this exists

A pod-facing DB role password currently exists in **two stores**: OpenBao
(`cogni/<env>/<node>`, synced to the pod by ESO) **and** a GitHub Environment
secret rendered into VM `/opt/cogni-template-runtime/.env` (used by
`db-provision` to create the role). Equal only by construction; rotate either
independently and they diverge → `28P01` → `/readyz` 502 (the candidate-a
2026-06-04 outage, bug.5002). This runbook makes OpenBao the **sole source** per
[`secrets-management.md` Invariant 15](../spec/secrets-management.md#core-invariants).

This is the **env-genesis half**. The node half — `secret-materialize` →
read-only `reconcile-substrate` → `assert-substrate` — is
[`node-wizard-secret-setting.md`](../design/node-wizard-secret-setting.md) / #1582.

## Model (see the contract; not restated here)

The custody model is canonical in
[`secrets-management.md`](../spec/secrets-management.md) (Invariant 15 +
DB-credential provisioning) and
[`secrets-classification.md`](../spec/secrets-classification.md). The two facts
that govern this runbook:

- **DB creds are per-node, not `_shared`.** They are deliberately absent from the
  `_shared` classification, and `_shared` itself is a transitional bank being
  purged toward owner-scoped paths. **Do not create a `cogni/<env>/_shared` DB
  path** — pod-facing DB material lives at `cogni/<env>/<node>`.
- **The env superuser is not pod-facing.** `POSTGRES_ROOT_PASSWORD` and the
  Doltgres superuser password stay **Compose/bootstrap-only**; no pod consumes
  them, so they are out of scope for this OpenBao migration (`_system` at most, if
  ever removed from GH env — never `_shared`).

> An earlier draft of this runbook imported the superuser + four derived passwords
> into `cogni/<env>/_shared`. That was wrong: it adopted the deferred shared-bank
> and propped up the shared `app_user` we are removing. Removed.

## Precondition — per-node roles (the crux, not yet built)

`provision.sh` today creates **three env-shared roles** —
`app_user` / `app_service` / `app_readonly` (`postgres-init/provision.sh:143,159,173`)
— and grants them onto every `cogni_<node>` database. Making OpenBao the sole
source **without** a shared OpenBao DB path therefore **requires per-node roles**
(`app_<node>` / `service_<node>`, each with its own `source: agent` password the
node generates). That `db-provision` change is the per-node-role step #1582
deferred and is the **precondition for this repair**. Until it lands, the only
available "fix" would reintroduce a shared OpenBao DB path — which this runbook
explicitly does not do.

## Per-env procedure (once per-node roles exist)

Order: **candidate-a** (reprovision-friendly) → **preview** → **production**
(maintenance-aware).

1. **Materialize** — `secret-materialize <env> <node>` generates the node's own
   `APP_DB_PASSWORD` / `APP_DB_SERVICE_PASSWORD` (`source: agent`) and composes the
   DSNs into `cogni/<env>/<node>` (the DSN is self-composable from the node's own
   creds — no shared read).
2. **Provision per-node roles** — the per-node-role `db-provision` creates
   `app_<node>` / `service_<node>` from the OpenBao values (`<env>-db-reader`),
   grants them onto `cogni_<node>`, and the node's pod reconnects under its own
   role. The shared `app_user` grants are retired once every node has migrated.
3. **Provisioners read OpenBao only** — delete the in-script `derive_secret`
   block (`deploy-infra.sh:838-860`) and the `${X:-$(remote_env_value …)}` `.env`
   fallbacks. On an OpenBao read miss, **fail loud and skip** the role create —
   never fall back to `.env` (the bug.5002 anti-fix).
4. **Remove DB passwords from GitHub Environment secrets** — once OpenBao is
   authoritative, delete the `APP_DB_*_PASSWORD` env secrets so no parallel store
   can re-diverge a deploy.
5. **Falsifying gate** (below).

## Safety rules

- **Never `ALTER … PASSWORD` a live role to a rendered `.env` value** to "self-heal
  drift" — that is the bug.5002 anti-fix; it makes the deploy a second writer and
  converts silent drift into an active 502. Fix the **source** (point the
  provisioner at OpenBao), never overwrite the DB from `.env`.
- Per-node roles are **created new**; migrate DB access via `GRANT`, prove the pod
  is green under the new role, **then** retire the shared role + GH-env copy. No
  destructive ownership change before green.
- Every VM-mutating step lands as a committed script + provisioner diff, never an
  SSH one-off (`feedback_vm_edits_need_git_capture`).

## Falsifying gate (proves split-brain is dead)

```bash
# remove the .env copy so .env can no longer be the source
ssh root@$VM_HOST "sed -i.bak '/^APP_DB_PASSWORD=/d' /opt/cogni-template-runtime/.env"
# run the node lane + a deploy; prove the app comes up green from OpenBao only
```

Pass = apps reach `/readyz` healthy and `/version` serves with `APP_DB_PASSWORD`
absent from `.env`; Loki shows the `<env>-db-reader` subject reading
`cogni/<env>/*`, zero `28P01`. Capture the proof on the PR.

## Per-env notes

| Env           | Posture                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `candidate-a` | Throwaway. Easiest path is a **reprovision** with the per-node-role `provision.sh`, then run the gate. No live users to protect.   |
| `preview`     | Semi-live. In-place migration (Steps 1–5), per node, then the gate.                                                                |
| `production`  | Live. In-place migration in a maintenance-aware window; have rollback ready (retire the shared role only after every node green). |

## Related

- [`secrets-management.md`](../spec/secrets-management.md) — Invariant 15 + DB-credential provisioning (the contract)
- [`secrets-classification.md`](../spec/secrets-classification.md) — why DB creds are per-node, not `_shared`
- [`node-wizard-secret-setting.md`](../design/node-wizard-secret-setting.md) — the node materialize/reconcile lane
- [`secrets-rotate.md`](./secrets-rotate.md) — steady-state rotation (rewrite its static-DB-rotation section once provisioners read OpenBao)
