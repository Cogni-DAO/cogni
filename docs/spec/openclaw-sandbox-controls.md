---
id: openclaw-sandbox-controls-spec
type: spec
title: OpenClaw Sandbox Controls Design
status: active
spec_state: draft
trust: draft
summary: Host-side git relay, dynamic agent catalog, credential strategy, and anti-patterns for sandbox code agents
read_when: Implementing sandbox agent variants, git relay, or sandbox dashboard
owner: derekg1729
created: 2026-02-07
verified: 2026-02-12
tags: [sandbox, openclaw]
---

# OpenClaw Sandbox Controls Design

> [!CRITICAL]
> Sandbox agents produce code changes inside the OpenClaw gateway container (long-running, `sandbox-internal` + `cogni-edge` networks). Gateway has internet egress and `GITHUB_TOKEN` for `gh` CLI / curl. **Host-side git relay** handles push via `docker exec` + `bundle` extraction with `sandbox/*` branch allowlist. UI surfaces are Cogni-native (Next.js), not OpenClaw's gateway UI.

## Context

The sandbox runtime (SANDBOXED_AGENTS.md, invariants 1-19) provides isolated container execution. This spec extends that foundation with controls for OpenClaw-specific agent variants, host-side git relay for code PRs, dynamic catalog discovery, and credential management.

## Goal

Define the invariants and design contracts for sandbox agents that produce code changes: how agent variants are registered, how git credentials are kept off the sandbox, how the UI discovers agents dynamically, and how the credential strategy evolves from env vars to GitHub App installation auth.

## Non-Goals

- OpenClaw's gateway UI or Lit-based Control UI (COGNI_NATIVE_UI)
- Passing git credentials into sandbox containers (SECRETS_HOST_ONLY)
- Building dashboard before git relay is operational (P2 condition)
- Hot-reload agent configuration (requires git commit + deployment)

## Core Invariants

> Numbering continues from [OpenClaw Sandbox](openclaw-sandbox-spec.md) invariants 13–19.

20. **HOST_SIDE_GIT_RELAY**: All git operations requiring credentials (push, PR create) execute on the host, never inside the sandbox. In gateway mode, the host uses `docker exec` to run git commands inside the long-running container and `git format-patch` to extract commits. In ephemeral mode (deprioritized), the host clones pre-run and pushes post-run from the host filesystem. Agent commits locally; host extracts and pushes after the agent session completes.

21. **CATALOG_FROM_API**: Chat UI fetches agent list from `GET /api/v1/ai/agents` at runtime. No hardcoded `AVAILABLE_GRAPHS` array. The API returns both langgraph and sandbox agents — the hook is a full replacement.

22. **ENV_CREDENTIALS_FIRST**: P1 uses `GITHUB_TOKEN` env var on the host for git push + PR creation. No `ConnectionBroker` dependency. Upgrade to GitHub App installation auth (via `TENANT_CONNECTIONS_SPEC.md`) at P2.

23. **BRANCH_KEY_IDENTITY**: Git relay branches are named `sandbox/<branchKey>` where `branchKey` is a stable identifier for a line of work, **not** the ephemeral `runId`. Multiple runs and agents can append commits to the same branch. `runId` is for audit/logging/billing only.

24. **WORKSPACE_SURVIVES_FOR_PUSH**: In ephemeral mode, workspace cleanup is deferred until after host-side push completes. In gateway mode, the workspace persists on a named volume (`cogni_workspace`) and is not cleaned up per-run — branch reset is the cleanup mechanism.

25. **COGNI_NATIVE_UI**: Dashboard and controls are Next.js pages within the existing app shell. OpenClaw's Lit-based Control UI is not exposed (invariant 18: NO_OPENCLAW_DASHBOARD). All observability routes through Cogni's existing Pino/Loki/Langfuse/Prometheus stack.

26. **AGENT_VARIANTS_IN_REGISTRY**: Multiple sandbox agent types (simple LLM, OpenClaw coder) are entries in `SANDBOX_AGENTS` registry inside `SandboxGraphProvider`. Each maps to an image + argv + limits + workspace setup function. No separate providers per agent type.

---

## Design

### 1. Agent Variant Registry (not separate providers)

| Agent              | Image                                       | Limits        | Workspace Setup                                       |
| ------------------ | ------------------------------------------- | ------------- | ----------------------------------------------------- |
| `sandbox:agent`    | `cogni-sandbox-runtime` (adapter default)   | 120s / 512MB  | Write `messages.json` only                            |
| `sandbox:openclaw` | `cogni-sandbox-openclaw` (per-run override) | 600s / 1024MB | Write `openclaw.json` + `prompt.txt` + behavior files |

**Rule:** One `SandboxGraphProvider` handles all sandbox agents. Agent-specific logic lives in the registry entry's workspace setup function, not in separate provider classes.

**OpenClaw argv** (joined by provider, run via entrypoint `bash -lc`):

```
node /app/dist/index.js agent --local --agent main
  --session-id ${runId}
  --message "$(cat /workspace/.cogni/prompt.txt)"
  --json --timeout 540
```

**OpenClaw env** (via `llmProxy.env`):

```
HOME=/workspace
OPENCLAW_CONFIG_PATH=/workspace/.openclaw/openclaw.json
OPENCLAW_STATE_DIR=/workspace/.openclaw-state
OPENCLAW_LOAD_SHELL_ENV=0
```

**OpenClaw limits rationale:** OpenClaw runs a multi-turn tool loop (5–50+ LLM calls per run). Container `maxRuntimeSec: 600` with OpenClaw `--timeout 540` gives 60s for clean exit before hard kill. Memory increased to 1024MB because OpenClaw loads Node.js runtime + dependencies (~300MB baseline).

**Image override**: `SandboxRunSpec.image` overrides the adapter's constructor-level `imageName` default. This lets the provider select image per-agent without needing multiple adapter instances.

---

### 2. branchKey Contract

`branchKey` is the stable identifier for a git relay branch. It determines the branch name `sandbox/<branchKey>` and enables multi-run continuation on the same branch.

**branchKey source priority (strict):**

1. **Explicit `branchName`** (preferred) — caller provides the branch identity directly, e.g. via API parameter or UI input. This is the recommended path for all orchestrated workflows.
2. **`workItemId`** — derived from the work item being addressed, e.g. `task.0022`. Natural fit when the agent is executing a tracked task.
3. **`stateKey`** (opt-in only) — conversation-scoped key. **Never auto-derived.** Only used when the caller explicitly opts into thread-scoped branch mode. Reason: conversation scope != line-of-work scope; defaulting here creates long-lived junk branches with unrelated diffs.

**Rules:**

- If no branchKey can be resolved, git relay is **skipped** (agent runs normally, no branch/push/PR). This is not an error — it means the caller didn't request code output.
- `runId` is **never** used as branchKey. It is ephemeral (audit, logging, billing, temp artifacts only).
- `ensureWorkspaceBranch` is idempotent: if `sandbox/<branchKey>` already exists, check it out; if not, create from `baseRef`.
- Multiple runs and agents can append commits to the same branchKey. A single PR accumulates all changes.

---

### 3. Host-Side Git Relay Flow (Gateway Mode)

> Gateway is the only active execution mode (2026-02-12). Ephemeral mode is deprioritized.

```
┌──────────────────────────────────────────────────────────────────────┐
│ PRE-RUN (host → docker exec into gateway container)                   │
│ ──────────────────────────────────────────────                        │
│ 1. Resolve branchKey from request (explicit > workItemId > opt-in)    │
│ 2. ensureWorkspaceBranch(branchKey, baseRef):                         │
│    - If sandbox/<branchKey> exists locally → git checkout             │
│    - If not → git checkout -b sandbox/<branchKey> from baseRef        │
│ 3. Workspace: /workspace/current on cogni_workspace volume            │
│ 4. Result: agent will work on sandbox/<branchKey>                     │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ AGENT RUN (inside gateway container, via WebSocket session)           │
│ ──────────────────────────────────────────────                        │
│ - Agent reads /workspace/current/**, calls LLM, modifies files       │
│ - Agent runs: git add -A && git commit -m "..." (local only)          │
│ - No push (no credentials, sandbox-internal network only)             │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ POST-RUN (host → docker exec to extract, then host-side push)        │
│ ──────────────────────────────────────────────                        │
│ 1. docker exec: git log baseRef..HEAD → any new commits?             │
│ 2. If no commits: skip push, leave branch for future runs            │
│ 3. If commits: docker exec: git format-patch baseRef..HEAD --stdout  │
│ 4. Host: apply patches to local clone, push sandbox/<branchKey>      │
│ 5. Host: create or update PR via GitHub API (GITHUB_TOKEN)           │
│ 6. Return PR URL in GraphFinal.content                                │
└──────────────────────────────────────────────────────────────────────┘
```

**Concurrency model:**

- **P0**: Single mutable `/workspace/current`. One branchKey active at a time. Provider holds a branchKey lock to prevent concurrent mutation.
- **P0.5**: Per-branch git worktrees at `/workspace/wt/<branchKey>`. Eliminates checkout/reset races and supports concurrent branches.

**Why host-side push?** Defense-in-depth for git write operations. The `GitRelay` bundles commits out of the container and pushes from the host, enforcing a `sandbox/*` branch allowlist. The gateway container also has `GITHUB_TOKEN` for `gh` CLI read operations (issues, PRs, API queries), but the relay remains the controlled path for push.

**Why `docker exec` + `bundle`?** The gateway is a long-running container on a named volume — the host can't directly access the workspace filesystem (Docker Desktop). `docker exec` runs git commands inside the container; `bundle` serializes commits to stdout for the host to apply and push.

**Why not on `SandboxRunSpec`?** The port (`SandboxRunnerPort`) handles container execution only. Git relay is provider-level orchestration that wraps the gateway session — branch setup before, patch extraction after. This keeps the port interface simple and the security boundary clear.

---

### 4. Dynamic Catalog vs Hardcoded Graphs

Current state: `ChatComposerExtras` has a hardcoded `AVAILABLE_GRAPHS` array with 5 entries (brain, poet, ponderer, research, sandbox:agent) and a `CATALOG_STATIC_IN_P0` TODO noting this is temporary.

**P0 fix:** Create `useAgents()` hook that fetches `GET /api/v1/ai/agents` and maps to `GraphOption[]`. The API already returns both langgraph agents (from `LangGraphInProcAgentCatalogProvider`) and sandbox agents (from `SandboxAgentCatalogProvider`), so the hook fully replaces the hardcoded array.

```typescript
// useAgents.ts
export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/v1/ai/agents");
      const data = await res.json();
      return data.agents.map((a) => ({
        graphId: a.graphId,
        name: a.name,
        description: a.description,
      }));
    },
    staleTime: 5 * 60 * 1000, // 5 min — catalog changes rarely
  });
}
```

**Never** hardcode agent entries in UI components. The `AgentCatalogProvider` pipeline is the single source.

---

### 5. Credential Strategy (Phased)

**P1: Env var**

- `OPENCLAW_GITHUB_RW_TOKEN` in host `.env`
- Passed into gateway container as `GITHUB_TOKEN` (enables `gh` CLI for read operations)
- Used by host-side `GitRelay` for push (bundles out of container, pushes from host)
- Scoped to the org/repos this Cogni instance operates on

**P2: GitHub App Installation**

- Per-repo scoped tokens via `TENANT_CONNECTIONS_SPEC.md` `ConnectionBroker`
- `credential_type: "github_app_installation"`
- Multi-tenant: each billing account has its own GitHub App installation

**Note:** `GITHUB_TOKEN` is present in the gateway container for `gh` CLI / `curl` use. This is acceptable because the gateway runs our own agent config — not untrusted code. Ephemeral containers (`network=none`) never receive tokens.

---

## Anti-Patterns

| Pattern                                    | Problem                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| Pass tokens to ephemeral sandbox env       | Ephemeral runs untrusted code; tokens must stay out         |
| Derive branchKey from `runId`              | Branch explosion; blocks multi-run continuation (inv. 23)   |
| OpenClaw gateway inside sandbox            | Invariant 17; requires network listeners                    |
| Port OpenClaw's Lit UI                     | Wrong framework (we use Next.js), assumes gateway WebSocket |
| Separate `GraphProvider` per agent variant | Over-engineering; registry pattern is simpler               |
| Hardcode graphs in UI component            | Drifts from API catalog; violates CATALOG_FROM_API          |
| Git relay config on `SandboxRunSpec` port  | Port handles container exec only; git is provider-level     |
| Build `ConnectionBroker` for P1            | Over-engineering; env var sufficient for single-org         |

---

## Acceptance Checks

**Automated:**

- `pnpm check:docs` — validates spec frontmatter and required headings

**Manual:**

1. Verify `GET /api/v1/ai/agents` returns both langgraph and sandbox agents
2. Verify sandbox container has no network access and no git credentials
3. Verify host-side git relay pushes branch after successful agent run (P1)

## Related

- **Project:** [proj.sandboxed-agents](../../work/projects/proj.sandboxed-agents.md) — Roadmap, deliverables, file pointers
- [Sandboxed Agents](sandboxed-agents.md) — Core sandbox invariants 1–12, phase definitions (pending migration)
- [OpenClaw Sandbox Spec](../OPENCLAW_SANDBOX_SPEC.md) — OpenClaw container image, config, I/O protocol (pending migration)
- [Tenant Connections](tenant-connections.md) — P2 credential management via ConnectionBroker
- [Sandbox Scaling](../SANDBOX_SCALING.md) — Proxy architecture, threat model (pending migration)
- [Graph Execution](graph-execution.md) — GraphExecutorPort (pending migration)
- [Agent Discovery](agent-discovery.md) — AgentCatalogPort, discovery pipeline
