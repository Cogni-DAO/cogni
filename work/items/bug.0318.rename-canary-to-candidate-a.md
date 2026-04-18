---
id: bug.0318
type: bug
title: "Rename canary → candidate-a across .local/ artifacts, provision scripts, and any lingering references"
status: needs_triage
priority: 3
rank: 99
estimate: 3
created: 2026-04-18
updated: 2026-04-18
summary: "The flighting VM is consistently referred to as 'candidate-a' in the GH environment name, k8s namespace (cogni-candidate-a), and operator docs; but the .local/ artifacts from `scripts/setup/provision-test-vm.sh` are still named `canary-vm-*` (key, ip, age-key, secrets.env). This created a real incident during the task.0315 CP4.25 flight: the IP in `.local/test-vm-ip` (84.32.109.222) belonged to a different / stale VM, while the actual candidate-a VM is `.local/canary-vm-ip` (84.32.109.160). Rename so operators don't have to guess which file maps to which cluster."
outcome: "`.local/` file names match the canonical environment names used everywhere else (`candidate-a`, `preview`, `production`). Provisioning scripts emit files with the new names. Any docs that still reference `canary-vm-*` are updated. No naming drift between .local/ + GH env + k8s namespace + docs. Per feedback_secret_rotation_blast_radius: grep ALL workflows for the old name before deleting the old files; rename atomically in one PR."
spec_refs: []
assignees: []
project: proj.cicd-services-gitops
related:
  - project_canary_dead
  - task.0315
labels: [infra, naming, provision, follow-up]
---

# bug.0318 — Rename `canary` → `candidate-a` in .local/ + provision

## Observed

```
.local/canary-vm-ip:      84.32.109.160   ← this IS candidate-a
.local/test-vm-ip:        84.32.109.222   ← stale / different VM
```

The k8s namespace on `.local/canary-vm-ip`'s host is `cogni-candidate-a`. The GH environment is `candidate-a`. The overlay is `infra/k8s/overlays/candidate-a/`. Only the .local/ files + provision script kept the legacy `canary-vm-*` name.

Per memory note (`project_canary_dead.md`): canary-as-a-branch is dead; feat/fix/chore PRs target `main` directly. The ENV named `candidate-a` replaced it. The .local/ file names didn't follow.

## Incident

During task.0315 CP4.25 flight on 2026-04-18, I attempted the SSH hotfix against 84.32.109.222 (from `.local/test-vm-ip`) — wrong VM, SSH host key had changed. Correct host was 84.32.109.160 via `.local/canary-vm-key`. Burned ~5 minutes chasing a rabbit hole.

## Scope of rename

- `scripts/setup/provision-test-vm.sh`: emit `candidate-a-vm-*` instead of `canary-vm-*`.
- Any `.local/canary-vm-*` files: rename to `candidate-a-vm-*` (local dev artifact, not in git — but the naming contract is).
- `docs/guides/multi-node-deploy.md`: replaces `canary` labels with `candidate-a` in the examples.
- `docs/runbooks/INFRASTRUCTURE_SETUP.md`: same.
- grep for `canary-vm` / `CANARY_` across repo; if referenced from CI anywhere, update atomically.

## Out of scope

- The deploy-branch names `deploy/canary` / `deploy/preview` / `deploy/production` — those ARE still the Argo-watched branches. They're a separate axis from flighting envs and should keep their current names unless there's a separate reason to rename them.
- `canary` as a word elsewhere in the codebase if it refers to the deploy branch, not the VM / flight env.

## Validation

Fixed when: a fresh `provision-test-vm.sh` run writes `.local/candidate-a-vm-{ip,key,age-key,secrets.env}` (not `canary-vm-*`), and `grep -r canary-vm` across `docs/` + `scripts/` returns zero results outside explicit historical references. Deploy-branch names `deploy/canary` are left alone.

## Related

- [bug.0317](./bug.0317.candidate-flight-infra-hardcoded-main.md) — the workflow-plumbing bug that caused us to need to SSH in the first place
- [project_canary_dead](/Users/derek/.claude/projects/-Users-derek-dev-cogni-template/memory/project_canary_dead.md) — upstream decision
- task.0315 PR #900
