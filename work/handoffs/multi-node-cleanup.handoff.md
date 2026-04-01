---
id: multi-node-cleanup
type: handoff
work_item_id: task.0245
status: active
created: 2026-04-01
updated: 2026-04-01
branch: feat/multi-node-cleanup
last_commit: 01ab240b
---

# Handoff: Multi-Node Platform — Cleanup, Dev Workflow, Resy + Poly Nodes

## Context

- Cogni operates multiple "nodes" — sovereign AI app instances (poly for prediction markets, resy for restaurant reservations) sharing one operator infrastructure (Postgres, Temporal, LiteLLM, Redis)
- The `integration/multi-node` branch absorbed the cogni-resy-helper fork (PRs #678-#681) and established `nodes/` directory structure
- PR #682 (`feat/multi-node-cleanup`) builds proper full-platform nodes from the operator app, establishes dev workflow, and tracks remaining gaps
- Each node is currently a copy of `apps/operator/` (~840 files) — future task.0248 extracts shared code into `packages/node-platform`

## Current State

- **Merged to integration/multi-node:** PRs #678 (absorption), #679 (resy delta), #681 (web→operator rename), #680 (nodes/ bounded context)
- **PR #682 (in review):** 20 commits — node-template, poly, resy platform apps + dev scripts + docs. `pnpm check` passes (all 11 static checks)
- **Working:** Operator (:3000) boots, sign in, chat. Resy (:3300) boots, sign in, resy branding. Poly (:3100) boots, teal theme, chat works
- **Not working:** Sign-in buttons on node landing pages (bug.0255 — links to `/api/auth/signin` instead of RainbowKit modal). Poly's Three.js landing page is dead code (route group shadowing)
- **Deferred:** Resy reservations feature (task.0253 — needs full hex domain port from fork). Docker per-node containers (task.0247). Shared platform package (task.0248)

## Decisions Made

- **Full platform copy per node** (not thin wrappers) — each node has auth, chat, streaming, billing, treasury. Only DAO setup wizard removed. Rationale: nodes need to function independently. Trade-off: code duplication until task.0248
- **Shared DB for v0** — all nodes use `cogni_template_dev`, same migrations, same RLS. Per-node DBs deferred to task.0247
- **Per-node NEXTAUTH_URL** — `dev:poly`/`dev:resy` scripts set NEXTAUTH_URL to the node's port so OAuth redirects work. Cookies shared across localhost ports (same AUTH_SECRET)
- **Arch check excludes nodes** — dep-cruiser only checks `apps/operator/` because nodes' `@/` paths resolve via their own tsconfigs, not `tsconfig.base.json`. Proper enforcement comes with task.0248

## Next Actions

- [ ] Merge PR #682 to `integration/multi-node`
- [ ] Fix node sign-in flow (bug.0255) — wire `useTryDemo` hook into poly Header/Hero, fix resy homepage
- [ ] Fix poly landing page route shadowing — `(public)/page.tsx` overrides `page.tsx` where Three.js components live
- [ ] Port resy reservations feature (task.0253) — full hex domain from cogni-resy-helper fork
- [ ] Design multi-node CI/CD (task.0247) — Docker Compose per-node services + Caddy routing + per-node Postgres DBs
- [ ] Extract shared platform package (task.0248) — eliminate ~2500 duplicate files across 3 nodes
- [ ] Merge `integration/multi-node` → `staging` after CI/CD is proven

## Risks / Gotchas

- **tsconfig.base.json maps `@/*` → `apps/operator/src/*`** — node apps override this in their own `tsconfig.app.json` with `baseUrl: "."` + local paths. If you add new path aliases to operator, add them to all node tsconfigs too
- **`outputFileTracingRoot`** in node `next.config.ts` is `../../../` (3 levels to repo root), not `../../` like operator. Getting this wrong breaks Next.js standalone builds
- **Pre-commit hooks are not executable** on this branch (husky `.husky/pre-commit` permissions). Commits go through but hooks are skipped. Verify with `pnpm check` before pushing
- **Poly's NeuralNetwork.tsx has `@ts-nocheck`** — Three.js R3F JSX intrinsics don't type in strict mode. Tracked in task.0254 (can be closed once poly typecheck is validated)
- **`dev:stack:full` uses shell `&` backgrounding** — operator starts after infra, but poly/resy race. Works but output is interleaved. Separate terminals recommended for now

## Pointers

| File / Resource                                       | Why it matters                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `docs/guides/multi-node-dev.md`                       | Dev commands, testing, DB/auth setup for multi-node             |
| `nodes/node-template/app/tsconfig.app.json`           | The `@/*` path override pattern all nodes must follow           |
| `nodes/*/app/next.config.ts`                          | `outputFileTracingRoot` must be `../../../` for nodes           |
| `package.json` (root)                                 | `dev:poly`, `dev:resy`, `dev:stack:full`, `typecheck:*` scripts |
| `work/projects/proj.operator-plane.md`                | Multi-Node Infrastructure section — deliverable table           |
| `work/items/task.0247`                                | CI/CD + Docker + per-node DB design notes                       |
| `work/items/task.0248`                                | Shared platform package + UI standardization notes              |
| `work/items/bug.0255`                                 | Node landing page auth flow — root cause analysis               |
| `apps/operator/src/features/home/hooks/useTryDemo.ts` | The correct sign-in pattern nodes should use                    |
| `/Users/derek/dev/cogni-resy-helper/apps/web/src/`    | Resy fork source — reservations feature lives here              |
