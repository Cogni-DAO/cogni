# cogni-cli · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @cogni-dao
- **Status:** draft

## Purpose

The `cogni` developer CLI. v0 ships exactly one subcommand: `cogni dev`, which detects whether `claude` (Claude Code) and `codex` (OpenAI Codex CLI) are installed on the user's device, opens a small local HTTP server that can shell out to either, exposes that server publicly via a Cloudflare quick tunnel, and opens the user's default browser to the operator's `/runtimes/dev` page with the tunnel URL passed as a query string. Pattern lifted from `langgraph dev --tunnel` ↔ `smith.langchain.com/studio`.

The CLI never holds Anthropic / OpenAI credentials; it just shells out to whatever the user is already authenticated against locally.

## Pointers

- [BYO Agent Runtime Bridge research](../../docs/research/byo-agent-runtime-bridge.md): the original spike
- [BYO Agent Runtime Bridge spec](../../docs/spec/byo-agent-runtime-bridge.md): the chat-integrated design this CLI plugs into
- [Packages Architecture](../../docs/spec/packages-architecture.md): package conventions

## Boundaries

```json
{
  "layer": "packages",
  "may_import": [],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services",
    "packages"
  ]
}
```

**External deps:** none — only Node builtins (`node:http`, `node:child_process`, `node:net`) plus spawned subprocesses (`claude`, `codex`, `cloudflared`) that the user already has on PATH.

## Public Surface

- **Exports (root `@cogni/cli`):** `detectRuntimes`, `parseTunnelUrl`, plus `Runtime` / `RuntimeKind` types — re-exported for tests only.
- **Bin (`cogni`):** `dist/cli.js` is the executable entry point. Subcommand: `cogni dev`.
- **Files considered API:** `src/index.ts` (library barrel), `src/cli.ts` (binary entry).

## Ports (optional)

- **Uses ports:** none
- **Implements ports:** none (this is a leaf consumer that talks only to local subprocesses)

## Responsibilities

- This directory **does**: detect installed local agent runtimes; provision a per-session workspace dir under `~/.cogni/sessions/<id>/`; expose a 127.0.0.1 HTTP server; spawn agents with `HOME` overridden to the session dir and a pruned env; spawn cloudflared; print the studio URL; open a browser.
- This directory **does not**: hold Anthropic / OpenAI credentials, persist any state across runs (the session dir is torn down on shutdown), talk to the operator's database, or implement any operator API endpoint.

## Isolation contract (Phase 1)

`provisionSession()` (`src/dev/session.ts`) is the single seam for soft isolation:

- Spawned agents see `cwd = HOME = ~/.cogni/sessions/<id>/`.
- The env passed to spawn contains only the `ENV_ALLOWLIST` keys (`PATH`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_*`, `TMPDIR`, `NODE_PATH`) plus the overridden `HOME`. Secrets like `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `COGNI_API_KEY_*`, `AWS_*`, `GITHUB_TOKEN` never reach the agent.
- `~/.claude` and `~/.codex` are surfaced into the session dir via symlinks so the user's existing local CLI auth keeps working — but nothing else from the real home is reachable through `~`.
- This is **soft** isolation: an agent that runs `cat /Users/<u>/.ssh/id_rsa` (absolute path) still succeeds. Hard sandbox containment (Docker, user namespaces) is a Phase 4 follow-up tracked in the spec.

## Usage

```bash
pnpm --filter @cogni/cli build
pnpm --filter @cogni/cli typecheck
pnpm --filter @cogni/cli test
node packages/cogni-cli/dist/cli.js dev
```

## Standards

- No npm runtime dependencies. Node builtins only.
- The local server binds to `127.0.0.1` exclusively; public reachability is the cloudflared tunnel's job and the user's choice.
- CORS allow-list never contains `*`.

## Dependencies

- **Internal:** none (leaf package)
- **External:** none at runtime; `tsup`, `typescript`, `vitest` for build/test only.

## Change Protocol

- Update this file when subcommands, the local HTTP API, or the runtime detection probes change.
- Coordinate with the BYO Agent Runtime Bridge research doc for any transport / pairing-flow changes.

## Notes

- v0 ships behind no feature flag; the page lives at `/runtimes/dev` and only does anything if `?baseUrl=` is supplied by the CLI. Without that param the page renders pairing instructions and is otherwise inert.
- Cloudflare quick tunnels are flaky by design. If the tunnel disconnects mid-session, restart `cogni dev` — the studio URL changes each restart.
- `claude remote-control` requires a TTY today; for headless servers, wrap `cogni dev` in `tmux` until Anthropic ships a daemon mode (tracked upstream).
- Codex has no Channels equivalent; the page falls back to "completed-artifact" UX rather than live token streaming for both runtimes in v0.
