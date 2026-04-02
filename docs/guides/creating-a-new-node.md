---
id: guide.creating-a-new-node
type: guide
title: Creating a New Node
status: draft
trust: draft
summary: Technical scaffolding steps for creating a sovereign Cogni node from the template
read_when: Copying node-template, renaming packages, wiring root scripts, or adding node-specific graphs
owner: derekg1729
created: 2026-04-01
verified: null
tags: [nodes, setup, lifecycle]
---

# Creating a New Node — Technical Steps

This guide covers the mechanical scaffolding: copy, rename, wire, validate. For the full lifecycle (intake, DAO formation, branding, PR, DNS), see the [new-node skill](../../.claude/skills/new-node/SKILL.md).

> **Prerequisite:** `pnpm dev:stack` runs successfully. You have a node name, port, and mission locked in.
>
> **CI/CD note:** Nodes run locally only until task.0247 ships.

## 1. Copy the template

```bash
cp -r nodes/node-template/ nodes/{name}/
```

## 2. Rename packages

### `nodes/{name}/app/package.json`

```diff
- "name": "@cogni/node-template-app",
+ "name": "@cogni/{name}-app",
- "dev": "next dev -p 3200",
+ "dev": "next dev -p {port}",
- "start": "next start -p 3200 -H 0.0.0.0",
+ "start": "next start -p {port} -H 0.0.0.0",
```

### `nodes/{name}/graphs/package.json`

```diff
- "name": "@cogni/node-template-graphs",
+ "name": "@cogni/{name}-graphs",
```

### `nodes/{name}/.cogni/repo-spec.yaml`

The `/setup/dao` wizard generates this. Paste the wizard output here — don't manually craft UUIDs. The wizard produces `node_id`, `cogni_dao.*`, and `payments.status: pending_activation`. Then update the node-specific fields:

```yaml
node:
  slug: "{name}"
  display_name: "{Display Name}"
  description: "One-line mission"
```

### Assigned ports

| Node     | Port |
|----------|------|
| Operator | 3000 |
| Poly     | 3100 |
| Template | 3200 |
| Resy     | 3300 |

Pick the next available in the 3x00 range. Check: `grep -r '"dev":.*-p' nodes/*/app/package.json`

## 3. Wire environment variables

Each node gets its own database, auth secret, and billing endpoint. For v0, focus on `.env.local` — for the full propagation story (CI, Docker, deploy), see `.cursor/commands/env-update.md`.

### New vars (add to `.env.local` and `.env.local.example`)

```bash
DATABASE_URL_{NAME}="postgresql://app_user:password@localhost:55432/cogni_{name}"
DATABASE_SERVICE_URL_{NAME}="postgresql://service_user:password@localhost:55432/cogni_{name}"
AUTH_SECRET_{NAME}="{name}-dev-secret-at-least-32-characters-change-me!!"
```

### Update existing vars

```bash
# Append node DB to provision list
COGNI_NODE_DBS=cogni_operator,cogni_poly,cogni_resy,cogni_{name}

# Append billing callback endpoint — key MUST be the node_id UUID (not slug).
# The billing router stamps UUIDs in LLM callback metadata and looks them up here.
COGNI_NODE_ENDPOINTS=...,<node-uuid>=http://host.docker.internal:{port}/api/internal/billing/ingest
```

Also update `.env.test` / `.env.test.example` with test-safe equivalents.

## 4. Register in operator repo-spec

Add an entry to `.cogni/repo-spec.yaml` `nodes[]`:

```yaml
- node_id: "<uuid-from-wizard>"
  node_name: "{Display Name}"
  path: "nodes/{name}"
  endpoint: "http://{name}:{port}/api/internal/billing/ingest"
```

The `endpoint` field is currently declaration-only (not consumed at runtime — the billing router reads `COGNI_NODE_ENDPOINTS` env var instead). Future: auto-generate env var from repo-spec at startup.

## 5. Wire root scripts

Add to the **root** `package.json` scripts:

```json
"dev:{name}": "COGNI_REPO_PATH=$(pwd)/nodes/{name} NEXTAUTH_URL=http://localhost:{port} dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_{NAME} DATABASE_SERVICE_URL=$DATABASE_SERVICE_URL_{NAME} AUTH_SECRET=$AUTH_SECRET_{NAME} pnpm --filter @cogni/{name}-app dev'",
"typecheck:{name}": "tsc -p nodes/{name}/app/tsconfig.app.json --noEmit"
```

`COGNI_REPO_PATH` points to the node's own directory (not repo root). The script remaps per-node env vars at runtime so the app sees standard `DATABASE_URL` / `AUTH_SECRET`. Follow the exact pattern from `dev:poly` / `dev:resy`.

## 6. Wire migration script

Add to root `package.json`:

```json
"db:migrate:{name}": "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_{NAME} tsx node_modules/drizzle-kit/bin.cjs migrate'"
```

Then append `pnpm db:migrate:{name}` to the `db:migrate:nodes` composite script.

## 7. Provision database and install

```bash
pnpm install
pnpm db:provision:nodes    # creates cogni_{name} DB + roles via COGNI_NODE_DBS
pnpm db:migrate:nodes      # runs Drizzle migrations on all node DBs sequentially
pnpm typecheck:{name}
```

## 8. Add a custom graph

Create `nodes/{name}/graphs/src/graphs/{name}-brain/`:

| File | Purpose |
|------|---------|
| `graph.ts` | Graph factory — `createReactAgent` or custom `StateGraph` |
| `prompts.ts` | System prompt — the brain's personality |
| `tools.ts` | Tool ID constants for capability lookup |

Export from `nodes/{name}/graphs/src/graphs/index.ts`:

```typescript
export { createMyBrainGraph, MY_BRAIN_GRAPH_NAME } from "./{name}-brain/graph";
export { MY_BRAIN_TOOL_IDS } from "./{name}-brain/tools";
```

The template's `graphs/src/index.ts` re-exports the shared `LANGGRAPH_CATALOG`. Your graphs extend it — they don't replace it.

Build: `pnpm --filter @cogni/{name}-graphs build`

## 9. Validate locally

```bash
pnpm dev:stack          # terminal 1: infra + operator
pnpm dev:{name}         # terminal 2: your node
```

Check:
- `http://localhost:{port}` loads
- Branding shows (after styling guide is applied)
- Auth works (shared cookies across localhost ports)
- Chat responds

## Gotchas

| Issue | Fix |
|-------|-----|
| `tsconfig.app.json` base path | Must use `../../../tsconfig.base.json` (3 levels up) |
| `next.config.ts` `outputFileTracingRoot` | Must be `../../../` not `../../` |
| ~3 GB RAM per node | Each is a full Next.js app; task.0248 fixes this |
| Biome doesn't lint nodes | By design — catch issues via typecheck |
| Port collisions | Always check existing assignments first |
| `node-template` references left behind | Grep: `grep -r "node-template" nodes/{name}/` |
| Env vars only in `.env.local` | v0 limitation — see `.cursor/commands/env-update.md` for full propagation (CI, Docker, deploy) |

## See also

- [New Node Styling Guide](new-node-styling.md) — icon, colors, metadata, homepage, chat suggestions
- [Multi-Node Dev Guide](multi-node-dev.md) — running, testing, DB/auth setup
- [Node Formation Spec](../spec/node-formation.md) — DAO formation and repo-spec
