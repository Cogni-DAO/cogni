---
id: feat.discord-channel-agents.handoff
type: handoff
work_item_id: feat.discord-channel-agents
status: active
created: 2026-02-19
updated: 2026-02-19
branch: feat/poet
last_commit: caad7049
---

# Handoff: Discord Channel-Specific OpenClaw Agents

## Context

- CogniDAO's Discord server has topic-specific channels (`#poetry-🌼`, `#ideas-🧠`, `#development-🤓`) that each need a dedicated AI persona
- Each channel routes to its own OpenClaw agent via `bindings` (peer-based channel routing), with its own SOUL.md, model, and tool policy
- Agent workspaces live as subdirectories under the existing `gateway-workspace/` bind mount — no per-agent Docker compose changes needed
- The main agent's `BOOTSTRAP.md` was extended to create git worktrees (`gov/ideas`, `gov/development`) so channel agents can commit/push independently
- The poet agent is committed, tested, and working. The ideas and development agents have config + SOUL.md but are uncommitted and still being iterated

## Current State

- **Poet** (`#poetry-🌼`): Committed (`caad7049`). Working in production. Uses `gpt-4o-mini`, all tools denied, pure conversation. SOUL.md copied from `langgraph-graphs/poet/prompts.ts`.
- **Ideas** (`#ideas-🧠`): Uncommitted. SOUL.md contains full inline workflow (no skill dependency) for capturing story work items. Uses `kimi-k2.5` with thinking off. Multiple models were tried — `gpt-4o-mini` was too weak, `gemini-3-flash` with thinking burned all tokens on reasoning and emitted nothing. Kimi k2.5 untested.
- **Development** (`#development-🤓`): Uncommitted. Placeholder SOUL.md only — workflow TBD.
- **BOOTSTRAP.md**: Uncommitted. Extended with repo clone + worktree creation for `ideas-repo` and `dev-repo`.
- Bootstrap has been manually run on the live gateway — worktrees exist at `/workspace/ideas-repo/` and `/workspace/dev-repo/`.

## Decisions Made

- **One mount, many agents**: Agent workspaces are subdirs of `gateway-workspace/`, not separate bind mounts. Adding an agent = config + SOUL.md, zero infra changes. See `BOOTSTRAP.md` filesystem layout.
- **No skill invocation for ideas agent**: OpenClaw skill invocation was unreliable (agent tried `openclaw help` as bash, didn't understand `/idea` as a text command). The ideas SOUL.md now contains the full workflow inline — template copy, frontmatter, index update, commit, push.
- **Centralized bootstrap**: All worktree setup lives in `gateway-workspace/BOOTSTRAP.md`, not in individual agent SOUL.md files. Channel agents assume their worktree exists.
- **`staging` is source of truth**: All agent branches (`gov/ideas`, `gov/development`) branch from `origin/staging`, never `main`.

## Next Actions

- [ ] Test the ideas agent end-to-end: restart gateway, send idea in `#ideas-🧠`, verify story file created on `gov/ideas` branch
- [ ] If Kimi k2.5 doesn't work for ideas, try `deepseek-v3.1` or `claude-sonnet-4.5`
- [ ] Design the development agent's workflow and write its SOUL.md
- [ ] Commit ideas + development + BOOTSTRAP.md changes once tested
- [ ] Decide whether `gov/ideas` branch should auto-PR to `staging` or accumulate

## Risks / Gotchas

- **`/repo/current/` is read-only** — agents must use their worktrees, never write to the mirror. `git worktree add` from `/workspace/repo/` (the clone), not from `/repo/current/`.
- **`thinkingDefault: "high"` inherited by default** — caused Gemini 3 Flash to burn all tokens on reasoning with zero output. Override per-agent with `"thinkingDefault": "off"` for models that don't support `reasoning_effort`.
- **OpenClaw skills are fragile** — agents don't reliably understand how to invoke them (tried bash commands, hallucinated files). Inline the workflow in SOUL.md instead.
- **Gateway restart required** — config and workspace changes only take effect after container recreate. No hot reload.
- **Global tool deny list includes `message`** — if a channel agent needs to send mid-task Discord messages, it needs a per-agent tool deny list that omits `message`.

## Pointers

| File / Resource                                                   | Why it matters                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `services/sandbox-openclaw/openclaw-gateway.json`                 | Agent definitions, bindings, model config                         |
| `services/sandbox-openclaw/gateway-workspace/BOOTSTRAP.md`        | Centralized bootstrap: governance memory + repo clone + worktrees |
| `services/sandbox-openclaw/gateway-workspace/poet/SOUL.md`        | Working example of a channel agent SOUL.md                        |
| `services/sandbox-openclaw/gateway-workspace/ideas/SOUL.md`       | Ideas agent workflow (untested, inline, no skill)                 |
| `services/sandbox-openclaw/gateway-workspace/development/SOUL.md` | Development agent placeholder                                     |
| `/Users/derek/dev/openclaw/src/routing/resolve-route.ts`          | How OpenClaw routes messages to agents via bindings               |
| `/Users/derek/dev/openclaw/src/agents/agent-scope.ts:166`         | How OpenClaw resolves agent workspace directories                 |
| `packages/langgraph-graphs/src/graphs/poet/prompts.ts`            | Original poet system prompt (source for poet SOUL.md)             |
