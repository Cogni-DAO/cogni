---
id: feat.gov-heartbeat
type: handoff
work_item_id: feat.gov-heartbeat
status: active
created: 2026-02-19
updated: 2026-02-19
branch: feat/gov-heartbeat
last_commit: 5ec024d4
---

# Handoff: Replace 4 Governance Loops with 1 Heartbeat

## Context

- 4 hourly governance schedules (GOVERN, COMMUNITY, ENGINEERING, SUSTAINABILITY) were burning LLM tokens with no provable beneficial output
- The `ideas` and `development` OpenClaw agents do real work on `gov/ideas` and `gov/development` branches, but nothing systematically merged their work into staging
- Goal: 1 hourly heartbeat that checks git branch deltas and posts status to Discord via the existing OpenClaw bot
- This is "Heartbeat v0" — report-only, no PR automation (that's v2 after 48h stable)

## Current State

- repo-spec.yaml: 4 schedules replaced with 1 `HEARTBEAT` schedule — **done, verified**
- SOUL.md trigger router: updated to route `HEARTBEAT` → `/git-sync` — **done**
- `/git-sync` skill created: deterministic branch scan + Discord post via `message` tool — **done**
- `message` tool removed from `tools.deny` in openclaw-gateway.json — **done**
- Governance model changed from `deepseek-v3.2` → `kimi-k2.5` — **done**
- Schedule sync `disableSchedule` callback: pauses Temporal + sets DB `enabled=false` — **done, verified** (`pnpm governance:schedules:sync` returns `paused:4`, DB rows correctly disabled)
- `/gov` page font size for upcoming runs increased — **done**
- Old gov-\* skills (gov-govern, gov-community, gov-engineering, gov-sustainability, gov-core) left in place as manually-invocable

## Decisions Made

- **No PR automation in v0** — just git delta reporting. PR creation is v2 after heartbeat proves stable
- **No new OpenClaw agents** — the `main` agent runs the heartbeat via skill dispatch, same as before
- **Discord via `message` tool** (not webhooks) — same infrastructure the other agents use
- **Direct serviceDb for disableSchedule** — `ScheduleUserPort.updateSchedule` has a latent bug where it passes DB UUID to `scheduleControl.pauseSchedule()` (expects Temporal ID), causing rollback. Documented in code comment.
- **Silence rule** — heartbeat posts to Discord only when branch deltas change vs last snapshot

## Next Actions

- [ ] End-to-end test: trigger `HEARTBEAT` via scheduler or manual gateway call, verify `/git-sync` runs and Discord message appears
- [ ] Set up `DISCORD_WEBHOOK_URL` env var OR verify `message` tool can target channel `1473931118603534356` without a binding
- [ ] Monitor for 48h — confirm silence when idle, posts only on change
- [ ] v2: Add PR creation for branches with commits ahead of staging
- [ ] Fix latent bug: `DrizzleScheduleUserAdapter.updateSchedule` passes DB UUID to `scheduleControl.pauseSchedule()` — should use `temporalScheduleId` from the row

## Risks / Gotchas

- The `message` tool was previously denied for security (untrusted sandbox agents). Now enabled globally — consider per-agent tool overrides if this is a concern
- `heartbeat-state.json` snapshot lives in ephemeral `/workspace/gateway/memory/` — lost on container reset, causing a redundant first post
- The `upsertGovernanceScheduleRow` callback also uses raw serviceDb (pre-existing pattern, not introduced here)
- Old 4 governance schedules are paused in Temporal + disabled in DB, but their Temporal schedule objects still exist

## Pointers

| File / Resource                                                          | Why it matters                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `.cogni/repo-spec.yaml` (lines 79-84)                                    | Single HEARTBEAT schedule definition                               |
| `packages/scheduler-core/src/services/syncGovernanceSchedules.ts`        | Sync logic + `disableSchedule` dep interface                       |
| `src/bootstrap/jobs/syncGovernanceSchedules.job.ts`                      | Wires deps with real DB/Temporal — `disableSchedule` callback here |
| `.openclaw/skills/git-sync/SKILL.md`                                     | The deterministic branch-check skill                               |
| `services/sandbox-openclaw/gateway-workspace/SOUL.md`                    | Trigger router: `HEARTBEAT` → `/git-sync`                          |
| `services/sandbox-openclaw/openclaw-gateway.json`                        | Agent config — `message` removed from deny list                    |
| `packages/db-client/src/adapters/drizzle-schedule.adapter.ts` (line 280) | Latent bug: DB UUID passed to Temporal pauseSchedule               |
| `src/app/(app)/gov/view.tsx`                                             | Upcoming runs UI + Countdown component                             |
