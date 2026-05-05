---
id: style-spec
type: spec
title: Style Guide
status: active
trust: draft
summary: Code style principles including hexagonal architecture, type safety, and file headers
read_when: Writing code, understanding style conventions, or code review
owner: derekg1729
created: 2026-02-05
verified: 2026-02-05
tags: []
---

# Style Guide

Code style principles for Cogni-Template. Enforcement in config files (`eslint.config.mjs`, `tsconfig.json`, `.prettierrc`).

## Principles

- **Hexagonal Architecture**: Dependencies point inward. See [Architecture](architecture.md).
- **Type Safety First**: Strict TypeScript, no `any`, explicit return types.
- **Code as Documentation**: File headers explain contracts.
- **Code speaks for itself**: No inline comments narrating _what_ code does — names and types are the docs. Put non-obvious _why_ (constraints, invariants, workarounds) in the TSDoc module header; route spec / work-item / design-doc references through its `Links:` field. Cross-file orientation lives in `AGENTS.md` Pointers, not sprawled across source.
- **Deterministic reproducibility**: Everything the system runs on lives in git — infra as code (GitOps via Argo + OpenTofu), memory as code (Dolt ops). Ad-hoc `ssh`, `kubectl`, one-off env vars, and console clicks are fine for a 5-minute experiment; anything that needs to stay gets captured as a script, terraform change, or GitOps commit before the session ends. If it isn't in git, it didn't happen.

## File Headers

All TypeScript/JavaScript files require TSDoc headers with SPDX license information.

### Source Files Example

```typescript
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/env/server`
 * Purpose: Server-side environment variable validation and type-safe configuration schema using Zod.
 * Scope: Validates process.env for server runtime; provides serverEnv object. Does not handle client-side env vars.
 * Invariants: All required env vars validated at startup; provides boolean flags for NODE_ENV variants; fails fast on invalid env.
 * Side-effects: process.env
 * Notes: Includes LLM config for Stage 8; validates URLs and secrets; provides default values where appropriate.
 * Links: Environment configuration specification
 * @public
 */
```

### Header Templates

Use these templates for different file types:

- **Source code**: [header_source_template.ts](templates/header_source_template.ts)
- **Unit/integration tests**: [header_test_template.ts](templates/header_test_template.ts)
- **End-to-end tests**: [header_e2e_template.ts](templates/header_e2e_template.ts)

## Architecture & Imports

- No `@adapters/*` → `@core/*`; use `@ports/*` only
- No parent-relative imports (`../` blocked)
- Barrel "wormholes" banned except one `index.ts` per layer root
- Path aliases required for inter-folder imports
- `verbatimModuleSyntax: true` requires explicit `import type` for types

## React & Next.js

- Default Server Components; `"use client"` only at UI leaves
- Explicit `revalidate`/`cache`/`no-store` per `fetch()`
- Strict `jsx-a11y`; accessible names required

## Styling

- Tailwind tokens only; no `style` prop
- Conventional Commits: `type(scope): subject` ≤72 chars

## References

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [google/gts](https://github.com/google/gts)
- [TSDoc](https://tsdoc.org/)
- [Architecture](architecture.md) - Layer boundaries
- Component tracking managed via code analysis tools
- `eslint.config.mjs` - Linting rules
- `tsconfig.base.json` - Shared TypeScript options + path aliases
- `tsconfig.json` - Solution-style config (project references only)

_Enforced by:_ `pnpm check` (lint, typecheck, format, tests, SPDX, repo-linter)
