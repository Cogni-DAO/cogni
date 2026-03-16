# Handoff: Sandbox Git-Sync Mount (P0) + OpenClaw Workspace Config

## Goal

Give OpenClaw gateway agent read-only access to the git-synced codebase (`repo_data` volume) and a writable scratch workspace.

## Status: ~90% done

### Completed

1. **docker-compose.dev.yml** — `openclaw-gateway` now mounts `repo_data:/repo:ro` + `/workspace` tmpfs (writable)
2. **sandbox-graph.provider.ts** — Ephemeral mode `runOnce()` now passes `volumes: [{ volume: "repo_data", containerPath: "/repo", readOnly: true }]` (was missing — the `SandboxVolumeMount` port existed but was never wired)
3. **openclaw-gateway.json** — Agent workspace set to `/repo/current` so file tools default there
4. **Stack tests** — LICENSE read (success) + LICENSE write (fail) + workspace writable + secrets isolation tests written in `sandbox-openclaw.stack.test.ts`
5. **Shared fixture** — `execInContainer()` added to `tests/_fixtures/sandbox/fixtures.ts`
6. **P1 task created** — `work/items/task.0009.sandbox-repo-refresh.md` under `proj.sandboxed-agents`

### Needs finishing

- **Import cleanup in test file**: `execInContainer` import was added at top but the duplicate mid-file removal may have left the file in a messy state. Read `tests/stack/sandbox/sandbox-openclaw.stack.test.ts` and verify imports are clean.
- **`depends_on: git-sync`** on `openclaw-gateway` was commented out by user because git-sync had an auth failure (stale `GIT_READ_TOKEN`). The `repo_data` volume was pre-populated so the mount works fine. Decision needed: add it back when token is fixed, or leave it out (gateway is resilient to missing volume content).
- **Run the stack tests** to confirm everything passes: `pnpm test:stack:docker -- tests/stack/sandbox/sandbox-openclaw.stack.test.ts`

## Key Files

| File                                                    | What changed / why it matters                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `infra/compose/docker-compose.dev.yml`                  | `openclaw-gateway` service — volumes, tmpfs, depends_on                           |
| `services/sandbox-openclaw/openclaw-gateway.json`       | OpenClaw agent config — `workspace: "/repo/current"`                              |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts` | Ephemeral mode `runOnce()` — `volumes` field now wired                            |
| `src/ports/sandbox-runner.port.ts`                      | `SandboxVolumeMount` interface (lines 34-41), `SandboxRunSpec.volumes` (line 100) |
| `src/adapters/server/sandbox/sandbox-runner.adapter.ts` | Lines 170-178 — handles `spec.volumes` → Docker MountSettings                     |
| `tests/stack/sandbox/sandbox-openclaw.stack.test.ts`    | Stack tests for repo mount + workspace                                            |
| `tests/_fixtures/sandbox/fixtures.ts`                   | `execInContainer()` shared helper                                                 |
| `work/items/task.0009.sandbox-repo-refresh.md`          | P1 task: on-demand git-sync refresh + port contract tightening                    |
| `docs/spec/git-sync-repo-mount.md`                      | Git-sync spec (boot sequence, UID alignment)                                      |

## Critical Context

- **UID 1001** alignment across git-sync, app (`nextjs`), and sandbox (`sandboxer`) — all must match or git rejects "dubious ownership"
- **`/repo:ro`** = shared read-only mirror. **`/workspace:rw`** = tmpfs scratch. Agent must never write to `/repo`.
- **OpenClaw sandbox mode is `"off"`** in config — agent runs unsandboxed, so file tools access anything the process can see. The `workspace` field controls the agent's default working directory.
- **P1 port gap**: `SandboxAgentEntry` has no `volumes` field — repo_data mount is hardcoded in `createContainerExecution()` instead of declared per-agent in the registry. See task.0009 for details.
- **Docker tmpfs masking**: Never mount volumes under `/run` — sandbox containers have tmpfs there that masks volume mounts. Use top-level paths like `/llm-sock/`, `/repo/`, `/workspace/`.
