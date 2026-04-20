---
id: task.0311.followup
type: handoff
work_item_id: task.0311
status: active
created: 2026-04-20
updated: 2026-04-20
branch: main
last_commit: 77df196cd
pr:
---

# Handoff: task.0311 post-merge — preview unblocked via known hack, real infra fix ahead

## One-sentence status

task.0311 (Doltgres knowledge plane) is merged and **proven live on candidate-a**; preview was blocked by an unrelated 2-week-old VM IP drift that bug.0334 / PR #943 exposed rather than caused; preview is now unblocked via a known-hack direct commit to deploy/preview; the real fix lives in [bug.0295](../items/bug.0295.public-repo-ip-leak.md) — **remove VM_IP from git entirely**.

## Cogni vision context (for the agent taking this)

The Cogni vision is: core operator agent + AI-run "nodes" iterating rapidly. End users talk to Cogni (prod), ask for work; Cogni builds, brings a web-accessible prototype back via the candidate slot. Public AI contributors can validate their change end-to-end on a real build without running a full `dev:stack`. **Candidate isn't "staging for a human reviewer" — it's "shared test environment for AI developers + end users."**

If AI contributors are going to spin up candidate slots on demand and multiple flights run concurrently, every piece of env-specific state in git is a merge conflict, a drift bug, and a "why did my flight fail" debugging session waiting to happen. The top-0.1% version of this system has **almost nothing environment-specific in git**. Overlays reference names, not addresses. Secrets come from a secrets manager. IPs come from DNS or service discovery. Git holds intent, the runtime holds state.

## What landed

### task.0311 itself — DONE

- PR [#894](https://github.com/Cogni-DAO/node-template/pull/894) merged as `eb832de78` on 2026-04-19
- candidate-a Doltgres: schema migrated via Argo PreSync Job (`poly-migrate-poly-doltgres`); `knowledge` table + 4 rows including one brain-written entry (`polymarket-settlement-2`); dolt_log carries the validation commit. **Proven end-to-end.**
- preview Doltgres: migrator ran once manually (ttl=600s) to prove the code path works on preview's DB; schema present, table empty and ready. Argo will own subsequent runs once the poly pod boots cleanly.

### Observability addon (in the same PR)

- `ai.tool_call.error` event added to `@cogni/node-shared` registry
- `inproc.provider.ts` on all 4 nodes now logs warn-level when `toolRunner.exec` returns non-ok — includes `tool`, `errorCode` enum, truncated `safeMessage`

### The drift discovered + unblocked

**Root cause chain (this one took a while):**

1. Preview VM was reprovisioned to `84.32.110.92` approximately 2026-04-05 (`.local/preview-vm-ip` mtime)
2. Main's overlay kept `84.32.109.222` (pre-reprovision IP) in inline EndpointSlice patches
3. Pre-#943, deploy/preview carried the same stale IP. Running pods limped along on cached Temporal connections; some cross-Service routes used in-cluster DNS rather than EndpointSlice IPs. Nobody noticed
4. PR #943 (bug.0334) refactored: inline patches → per-overlay `env-state.yaml` ConfigMap + kustomize `replacements:`. Main's env-state kept `.109.222` (faithful port of existing bad value)
5. Post-#943 merge, `promote-and-deploy.yml`'s authoritative rsync rendered deploy/preview overlay strictly from env-state.yaml. scheduler-worker boots fresh → tries Temporal at `.109.222` → `TransportError: Connection refused` → crashloop → every chat.completions workflow never gets picked up → client hangs 60s
6. **`#943 exposed the drift, didn't cause it.**

**Scheduler-worker port mismatch (separate, earlier finding):**

- scheduler-worker delegates graph runs to nodes via HTTP fetch (task.0280 pattern)
- `COGNI_NODE_ENDPOINTS` had `poly=http://poly-node-app:3100,resy=http://resy-node-app:3300` (container ports) instead of `:3000` (Service ports). Fetch RST → workflow retries forever → chat hangs
- PR #939 (bug.0333) moved ENDPOINTS from per-env overlay patch into base ConfigMap with correct `:3000` values. Was already in main before #943
- Running pods needed to restart to pick up fresh ConfigMap (`kubectl rollout restart deployment/scheduler-worker`)

### Known-hack unblock

Committed `chore(infra): correct preview VM_IP to 84.32.110.92 [known-hack]` to `deploy/preview` (commit `214ef15`) — env-state.yaml × 4 files, `.109.222` → `.110.92`. main untouched.

This is explicitly a known hack, not a design change. Permanent fix is bug.0295.

## What's left on the board

### The real fix: [bug.0295 — replace VM_IP with DNS](../items/bug.0295.public-repo-ip-leak.md) (design-reviewed 2026-04-20)

VM IPs do not belong in git. Every way to write them (main seed, provision-to-deploy, direct corrections) is a drift vector. The fix is:

- Overlays address dependencies by hostname (ExternalName Service or direct `host:port` env) resolved via cluster DNS
- Provisioning updates the DNS record — zero git commits
- `env-state.yaml` is removed entirely (or reduced to non-IP state)
- `provision-test-vm.sh` Phase 4c is deleted or rewritten to DNS-update
- `promote-and-deploy.yml` rsync simplifies to `rsync -a --delete` — no env-state exclusion

Recommended approach is ExternalName + DNS — standard k8s pattern, maps to existing Cloudflare DNS used for public hostnames. Alternative options (downward API via node annotation, Argo values substitution) captured in the task doc.

### Other known-but-not-this-task issues

- **chat.completions hang on candidate-a post-scheduler-restart.** Ports correct, ConfigMap fresh, workflow events fire, but curl still returns 0 bytes. Not a task.0311 bug. Not preview's IP bug either (candidate-a IPs match). Suspect graph-runner activity issue or scheduler-worker callback URL mismatch in a different dimension. Needs its own /bug file and deeper trace through scheduler-worker's `postCreate` → node callback path.
- **SSH needs `IdentitiesOnly=yes`** — not a CI/CD bug, an ssh-agent-pollution thing local to the agent's machine. Worth capturing in `~/.ssh/config` per-host.

### Open PRs observed (not task.0311 territory, for context)

- [#938](https://github.com/Cogni-DAO/node-template/pull/938) — closed (noise)
- [#942](https://github.com/Cogni-DAO/node-template/pull/942), [#944](https://github.com/Cogni-DAO/node-template/pull/944) — separate, unrelated
- [#910 revert](https://github.com/Cogni-DAO/node-template/pull/945) — merged as `c9d7cd520`; unblocked preview app rollout before #943

## What I would tell the next agent

1. **Merge this PR** (adds bug.0295 + this handoff). No code; docs only.
2. **Verify preview chat actually works** post-deploy-branch hack. Argo should pick up `214ef15` on its next sync. Spot-check: `scheduler-worker` pod on preview boots without `TransportError` crash. If yes, run brain V2 against `poly.cognidao.org` — `core__knowledge_write` + `core__knowledge_search` — close the task.0311 preview-validation loop.
3. **Drive bug.0295 to /design**. Use the three options listed; recommend A (ExternalName + DNS). Gate with /review-design before /implement. This is the systemic fix; without it we'll hit this exact class of bug again the next time any VM is reprovisioned.
4. **Separately file the candidate-a chat hang as a /bug**. It's independent of task.0311 and independent of #943.

## Commits to know

```
77df196cd  fix(cicd): overlays track main — env-state.yaml + INFRA_K8S_MAIN_DERIVED (bug.0334)  (#943 — exposed the drift)
c9d7cd520  revert(deps): revert viem-wagmi bump (#910)  (#945 — unblocked app rollout)
f1dd2a375  fix(ci): wire poly secrets through promote-and-deploy  (#940 — fixed POLY_PROTO_WALLET_ADDRESS)
3028b617e  fix(k8s): move envs-identical ConfigMap values from overlays to base  (#939 — ENDPOINTS port fix)
eb832de78  feat(doltgres): candidate-a wiring  (#894 — task.0311 merge)

214ef15    chore(infra): correct preview VM_IP to 84.32.110.92 [known-hack]  (on deploy/preview, NOT main)
```

## Related

- [task.0311 work item](../items/task.0311.poly-knowledge-syntropy-seed.md) — the shipped task
- [bug.0295 work item](../items/bug.0295.public-repo-ip-leak.md) — the real infra fix
- [Knowledge Data Plane spec](../../docs/spec/knowledge-data-plane.md) — as-built after task.0311
- [CI/CD spec](../../docs/spec/ci-cd.md) — where the DNS invariant needs to land after bug.0295 /design
- [devops-expert skill](../../.claude/skills/devops-expert/SKILL.md) — pipeline orientation (read before touching anything here)
