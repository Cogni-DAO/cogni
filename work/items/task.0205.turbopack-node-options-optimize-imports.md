---
id: task.0205
type: task
status: cancelled
title: "Add NODE_OPTIONS tuning + optimizePackageImports for workspace packages"
priority: 1
rank: 99
estimate: 1
summary: "Pruned — symptom management. NODE_OPTIONS raises the ceiling without reducing usage. optimizePackageImports is broken for pnpm workspace symlinks (vercel/next.js#75148). Both superseded by task.0204 (root cause fix)."
outcome: "N/A — pruned"
spec_refs:
project:
assignees: derekg1729
credit:
pr:
reviewer:
branch:
revision: 1
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [turbopack, memory, dx]
external_refs:
  - docs/research/turbopack-dev-memory.md
---

# NODE_OPTIONS Tuning + optimizePackageImports — PRUNED

Pruned during design review. Rationale:

- **NODE_OPTIONS**: Raises the GC ceiling without reducing actual memory usage. Masks the
  problem instead of fixing it. Developers can set this locally if needed.
- **optimizePackageImports**: Known broken for pnpm workspace symlinks (vercel/next.js#75148).
  Our `@cogni/*` packages are workspace symlinks, so this won't help.

Both are superseded by task.0204 which addresses the root cause (static container import
causing 36× module duplication).

## Validation

N/A — cancelled.
