---
id: task.0009
type: task
title: "Sandbox repo refresh: on-demand git-sync for agent workspace"
status: needs_design
priority: 1
estimate: 3
summary: Design and implement on-demand repo refresh so sandbox agents can trigger git-sync to pull latest code into their /repo mount, with per-session workspace isolation
outcome: Agent can call a repo_refresh tool that triggers git-sync, sees updated /repo/current, and works in a session-scoped /workspace clone — no cross-session contamination
spec_refs: git-sync-repo-mount-spec, openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.sandboxed-agents
branch:
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [sandbox, git-sync, p1]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 17
---

# Sandbox repo refresh: on-demand git-sync for agent workspace

## Context

P0 mounts `repo_data:/repo:ro` into sandbox containers — agents can read the codebase but the snapshot is frozen at boot (`GITSYNC_ONE_TIME=true`). This task adds the ability for agents to trigger a repo refresh and work in isolated per-session workspaces.

### Existing Infrastructure

The port layer already has the abstraction for this:

- **`SandboxVolumeMount`** (`src/ports/sandbox-runner.port.ts:34-41`) — interface for named Docker volume mounts (`volume`, `containerPath`, `readOnly`). JSDoc says "Used for git-sync repo volumes, shared caches, or artifact volumes."
- **`SandboxRunSpec.volumes`** (`sandbox-runner.port.ts:99-100`) — optional `volumes` field on the run spec
- **`SandboxRunnerAdapter`** (`sandbox-runner.adapter.ts:170-178`) — already handles `spec.volumes` → Docker `MountSettings`
- **`SandboxGraphProvider`** — P0 wired `volumes: [{ volume: "repo_data", containerPath: "/repo", readOnly: true }]` into `runOnce()` for ephemeral mode
- **docker-compose.dev.yml** — P0 added `repo_data:/repo:ro` + `depends_on: git-sync` to `openclaw-gateway`

The volume mount plumbing is complete. This task extends it with refresh capability and workspace isolation.

### Port Contract Gaps (must fix in this task)

The current `SandboxVolumeMount` / `SandboxRunSpec.volumes` contract is too loose:

1. **No declarative volume requirements on agents.** `SandboxAgentEntry` (in `sandbox-graph.provider.ts`) defines `image`, `argv`, `limits`, `setupWorkspace`, `extraEnv`, `executionMode` — but has no `volumes` field. The `repo_data` mount is hardcoded in the `createContainerExecution()` method body rather than declared in the agent registry entry. This means each new agent type must remember to add volumes manually.

2. **No adapter-level validation.** `SandboxRunnerAdapter.runOnce()` passes `spec.volumes` through to Docker without checking that required volumes exist or are mountable. A typo in volume name silently creates an empty Docker volume instead of failing.

3. **Gateway vs ephemeral divergence.** Ephemeral mode gets volumes via `SandboxRunSpec` (code-level). Gateway mode gets them via `docker-compose.yml` (infra-level). The same agent definition (`SANDBOX_AGENTS.openclaw`) has no visibility into what volumes the compose service mounts. These should be aligned — the agent entry should declare its volume requirements, and both modes should honor them.

**Proposed tightening:**

- Add `volumes?: readonly SandboxVolumeMount[]` to `SandboxAgentEntry` so volume requirements are declared per-agent, not scattered in execution methods
- Provider passes `agent.volumes` to `runOnce()` instead of hardcoding
- Adapter validates that named volumes exist before container creation (Docker API: `docker.getVolume(name).inspect()`)
- Gateway mode compose volumes should be generated from or validated against the same agent registry (stretch goal — may require compose templating)

## Design Constraints

- `/repo` is a **shared read-only mirror** — agents must never write to it
- Per-session workspace isolation: `/workspace/<session>/<project>` prevents cross-user file collisions
- git-sync owns updates to `/repo`; agents trigger refresh, not direct git ops on the mirror
- Multi-project: pre-mount multiple repo volumes at boot (`/repo/<project>:ro`), or 1 gateway per project/tenant
- Mounts are fixed at container create time — no runtime mount changes
- UID 1001 alignment already guaranteed across git-sync, app, and sandbox (`sandboxer`) containers

## Approach: SIGHUP-triggered git-sync

### Part A: Convert git-sync to long-running sidecar

- Change `GITSYNC_ONE_TIME=false`, add `GITSYNC_PERIOD=300s` (conservative poll)
- Add `GITSYNC_SYNC_ON_SIGNAL=SIGHUP` for immediate on-demand sync
- Change `restart: "no"` → `restart: unless-stopped`
- git-sync atomically swaps `/repo/current` symlink on each pull — all RO consumers see update instantly

### Part B: Host-side `repo_refresh` tool

- New cogni tool callable by agents via graph execution pipeline
- Implementation: `docker kill -s HUP git-sync` (Docker API call from host process)
- Returns: new SHA at `/repo/current` after sync completes
- No new containers, no HTTP sidecars — git-sync v4 supports SIGHUP natively

### Part C: Per-session workspace isolation

- Agent reads from `/repo/current` (shared, always fresh)
- Agent copies/clones target files into `/workspace/<session>/` for editing
- Write operations confined to session-scoped workspace directory
- OpenClaw `allowedDirectories`: `/repo/current` (read) + `/workspace` (write)

## Open Questions

1. Multi-project: should we support multiple repo volumes, or keep it 1:1 gateway-per-project?
2. Should `repo_refresh` block until sync completes, or return immediately with a "pending" status?
3. How does this interact with the host-side git relay (proj.sandboxed-agents P1)?

## Acceptance Criteria

### Port Contract Tightening

- [ ] `SandboxAgentEntry` has `volumes` field — agent declares its volume requirements
- [ ] Provider passes `agent.volumes` to `runOnce()` — no hardcoded volumes in execution methods
- [ ] Adapter validates named volumes exist before container creation (fail-fast on typo)
- [ ] P0 hardcoded `repo_data` mount in `createContainerExecution()` migrated to agent registry entry

### Repo Refresh

- [ ] git-sync runs as long-lived sidecar with configurable poll period
- [ ] SIGHUP triggers immediate sync (verified by SHA change)
- [ ] Agent tool `repo_refresh` triggers sync and returns new SHA

### Workspace Isolation

- [ ] Per-session workspace directories are isolated
- [ ] `/repo` remains read-only to all consumers
- [ ] No cross-session file contamination under concurrent use

## Validation

- `pnpm test:stack:docker -- tests/stack/sandbox/sandbox-openclaw.stack.test.ts` — repo mount read/write/workspace tests pass
- `pnpm check` — lint + type + format clean
- Manual: `docker exec openclaw-gateway cat /repo/current/package.json` returns valid JSON

## File Pointers

| File                                                     | Change                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/ports/sandbox-runner.port.ts`                       | Tighten `SandboxVolumeMount` contract, add volume-exists validation       |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`  | Move volumes from method body → `SandboxAgentEntry.volumes`, pass through |
| `src/adapters/server/sandbox/sandbox-runner.adapter.ts`  | Add volume-exists check before container creation                         |
| `platform/infra/services/runtime/docker-compose.dev.yml` | Convert git-sync to polling sidecar, SIGHUP support                       |
| `services/sandbox-openclaw/openclaw-gateway.json`        | `allowedDirectories` for `/repo/current` + `/workspace`                   |
