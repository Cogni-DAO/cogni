# tests/external · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable

## Purpose

External integration tests for `@cogni/langgraph-graphs`. These hit real network services (npm registry, real MCP servers via stdio). **Not** part of default CI — run on-demand via `pnpm test:external`.

## Pointers

- [Unit/inproc tests](../inproc/) — mocked, no network
- [Vitest external config](../../vitest.external.config.ts)

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

## Public Surface

- **Exports:** none
- **CLI:** `pnpm -F @cogni/langgraph-graphs test:external`
- **Env/Config keys:** none required (tests use public npm packages)

## Responsibilities

- This directory **does:** validate adapters against real external runtimes (e.g., real MCP servers downloaded via npx)
- This directory **does not:** run in unit/component/stack gates

## Standards

- File naming: `*.external.test.ts`
- Generous timeouts (60s) — first run downloads npm packages
- No required secrets — fail fast if missing rather than skip silently

## Dependencies

- **Internal:** `../../src/runtime/mcp/*`
- **External:** vitest, npx, real MCP servers (`@modelcontextprotocol/server-everything`)

## Notes

- **NOT** in default CI pipeline (unit → component → stack)
- Keep these out of the merge-queue path — they flake under cold caches
