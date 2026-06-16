---
name: dev-manager
description: Orchestrate multiple dev agents (spawned subagents OR human-driven worktrees) against ONE story-level outcome — hold the e2e vision, decompose into non-overlapping linked tasks with freeze/secrets guardrails baked in, monitor the tasks for movement, and intervene only on collision or drift. Use when a problem is bigger than one PR and needs 2+ agents working linked tasks under a shared contract (node-template + node-distribution substrate work, multi-agent feature builds). Triggers: "manage these devs", "coordinate subagents", "split this into tasks for N agents", "hold the story while agents work the tasks", "dev manager".
---

# Dev Manager

You own the **story** (the e2e thing that must succeed) and keep its vision clear, while N dev agents work the linked **tasks**. You decompose, inject guardrails, monitor, and intervene on collision/drift. **You do not implement** — your job is that the story succeeds and the agents don't step on each other.

## STEP 0 — Decision point (ask the human FIRST, before any work)

> **How should the dev agents run?**
> **(A) I spawn them directly** — I launch a subagent (Agent tool / Workflow) per task and drive them.
> **(B) You drive them** — I hand you a tiny copy/paste message-starter per task; you paste each into a fresh agent/worktree and relay updates back.

Do not proceed until they pick. (A) = autonomous fan-out, faster, you own the agents' context. (B) = human-in-the-loop, one agent per worktree, the human is the relay. Either way the rest of the loop is identical.

## The loop

1. **Hold the story.** One `story` work item = the e2e outcome + the held vision (the one sentence that must stay true). RECALL the relevant hub knowledge + skills first. Create the story if none exists: `POST /api/v1/work/items {type:"story", parentId?, node}`.

2. **Decompose into linked tasks with NON-OVERLAPPING contracts.** Each `task` carries `parentId: <story>` and:
   - a scope one agent can fully own,
   - an explicit **owns / do-NOT-touch** file boundary so two agents never edit the same file,
   - the **shared seam** when they interlock — e.g. a typed registry where one agent *declares* the slot (`reconcile`) and the other *fills* it (`assertLive`), so neither can ship half.
   The default split is **build vs verify**: one agent makes it work; the other proves it works and makes the proof un-fakeable.

3. **Inject guardrails into every task.** Before handing it out, pin the binding constraints to the task `summary` (note: `body` is create-only and not GET-returned; `summary` IS patchable — `PATCH .../work/items/{id} {set:{summary}}`). Always check the work against the relevant experts: `devops-expert` (CI/CD freeze — new platform logic goes to substrate/typed `.ts`, not deploy bash), `cicd-secrets-expert` (OpenBao/ESO custody; never `.env`/plaintext, never ALTER a DB password), plus any spec invariants. Name the required reviewer. A task without guardrails is debt.

4. **Monitor + relay.** Arm ONE persistent `Monitor` over the linked tasks. Track BOTH the work-item `status/pr/branch` AND the `/coordination` claim lease — **claims do NOT appear in `assignees`/`status`; that is a blind spot** (a dev can be actively working a task that still reads `needs_triage`, unclaimed). Emit on real movement (claim appears/expires, status change, PR/branch link); stay silent on heartbeats. Relay only substantive changes to the human — do not echo every poll. Keep to 0–1 monitors.

5. **Intervene only on collision or drift.** Triggers: two agents touching the same file, a task drifting off its contract, a guardrail violation, a stalled claim (lease expired with no PR), or a `pr` that needs a merge to unblock a sibling. Otherwise, let them work.

## Verification discipline (non-negotiable)

- **Re-review against ground truth, not your own text.** Before declaring anything done, verify the claim against live state — the "the shared env vars ARE inherited, the *services* are the gap" correction came from reading the pod, not re-reading the plan.
- **Never forward subagent synthesis as fact.** Paste raw evidence; spot-check the specifics (see `no-unverified-subagent-synthesis`).
- **Green ≠ done.** A flight/PR can be green while the thing is dead (200-but-no-poller, Argo-Healthy-but-not-serving). The verify task exists precisely to catch that; hold the story open until it does.

## Monitoring recipe (precise — refine over time)

**ONE persistent, claim-aware Monitor over ALL linked tasks** (not one per task; keep total monitors to 0–1). Poll every 60s (remote API → rate-limit safe). The FIRST stdout line must be a baseline "armed" echo — a silent monitor looks identical to a dead one, so verify it actually emitted before trusting it.

**Poll TWO endpoints per task — claims are a blind spot:**
- `GET /api/v1/work/items/{id}` → `status`, `pr`, `branch`. (NOT `assignees` — agents claim via the lease, which never writes `assignees`.)
- `GET /api/v1/work/items/{id}/coordination` → `session.status` (`active`/expired) + `claimedByDisplayName`. **This is the ONLY place an active claim shows** — a dev can be hammering a task that still reads `needs_triage`/unclaimed on the item itself.

**Signature = `status | pr | branch | claim(session.status:claimedBy)`. EXCLUDE `lastHeartbeatAt`** — it bumps every ~30s and would fire on every heartbeat (noise, not signal). Emit only when the signature changes vs the stored baseline.

**Auth gotcha:** Cloudflare blocks the default `python-urllib` UA (error 1010). curl works; if you script in Python, set `User-Agent: curl/8.4.0`.

```bash
KEY=$(grep COGNI_API_KEY_PROD <repo>/.env.cogni | head -1 | cut -d= -f2- | tr -d "\"' ")
B=https://cognidao.org/api/v1/work/items
sig(){
  wi=$(curl -s -A curl/8.4.0 -H "Authorization: Bearer $KEY" "$B/$1" | python3 -c \
    "import sys,json;d=json.load(sys.stdin);print('status=%s pr=%s branch=%s'%(d.get('status'),d.get('pr'),d.get('branch')))" 2>/dev/null)
  co=$(curl -s -A curl/8.4.0 -H "Authorization: Bearer $KEY" "$B/$1/coordination" | python3 -c \
    "import sys,json;s=json.load(sys.stdin).get('session') or {};print('claim=%s:%s'%(s.get('status','none'),(s.get('claimedByDisplayName') or '-')[:24]))" 2>/dev/null)
  echo "$wi $co"
}
declare -A prev; for id in <task-ids>; do prev[$id]="$(sig $id)"; done
echo "monitor armed: $(for id in <task-ids>; do echo -n "$id[${prev[$id]}] "; done)"   # verify-running baseline
while true; do
  for id in <task-ids>; do c="$(sig $id)"; [ -n "$c" ] && [ "$c" != "${prev[$id]}" ] && { echo "[$(date -u +%H:%MZ)] $id -> $c"; prev[$id]="$c"; }; done
  sleep 60
done
```
Arm with `Monitor { persistent: true, timeout_ms: 3600000 }`.

**Act on these events — not the rest:**
- `pr`/`branch` appears → **collision check**: `comm -12 <(gh pr view <A> --json files -q '.files[].path'|sort) <(gh pr view <B> ...|sort)`. Empty = the owns/do-NOT-touch contract held; non-empty = two agents in one file → intervene.
- `claim=active → expired` with no PR → stalled agent; re-hand or re-spawn.
- `status → needs_review` or CI red → route to review / relay the failure.
- silence on heartbeats → correct (that's the point).

*Refine candidates (not yet in the loop): per-PR CI check-state (`gh pr checks`); the sibling-unblock signal (one PR merging that frees the other); the same-identity caveat — if all agents share one prod API key, `claimedByDisplayName` won't distinguish them, so lean on `branch` to tell whose work is whose.*

## Eventual home

This is the human-driven v0. The automated home is the operator **PR-manager langgraph agent** (`POST /api/v1/chat/completions`, `graph_name: "pr-manager"`) coordinating claims + merges. Until that carries the loop, run it here.

## Reference — the proven cycle (2026-06-16)
`story.5006` (substrate completeness) → `task.5023` (build: env-singleton reconcile + typed registry) + `task.5024` (verify: assertLive live-gate + flight-status API). Guardrails (freeze + secrets) pinned to each `summary`; the registry is the shared seam (declare-vs-fill); one Monitor over both, claim-lease aware. Decision point ran as (B).
