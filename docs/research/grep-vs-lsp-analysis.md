---
id: grep-vs-lsp-analysis
type: research
title: "Research: Grep vs LSP Analysis for Claude Code Navigation"
status: draft
trust: draft
summary: "Comparison of grep vs LSP search strategies for navigating a strict TypeScript monorepo with path aliases, Zod contracts, and 16 workspace packages."
read_when: Configuring Claude Code search behavior, evaluating LSP plugins, or optimizing codebase navigation.
owner: claude
created: 2026-03-11
---

# Grep vs LSP Analysis for Claude Code Navigation

> Research spike: Which search strategy is optimal for this codebase?

## Codebase Profile

| Metric             | Value              |
| ------------------ | ------------------ |
| TypeScript files   | 1,067              |
| Lines of code      | ~138,000           |
| Workspace packages | 16                 |
| Path aliases       | 15+ (`@/*` family) |
| `z.infer` usages   | 157                |
| Contract files     | 20+                |
| Module resolution  | Bundler (strict)   |

## Comparison

| Dimension                     | Grep                               | LSP                                    |
| ----------------------------- | ---------------------------------- | -------------------------------------- |
| Path alias resolution (`@/*`) | Literal strings only               | Resolves aliases correctly             |
| Following `z.infer` chains    | Cannot cross type boundaries       | Follows type inference end-to-end      |
| Cross-package references      | Must search each package           | Understands workspace dependency graph |
| Generic/utility types         | False positives on partial matches | Semantic understanding                 |
| Speed (cold)                  | Fast — text search                 | Slower startup (server init)           |
| Speed (warm)                  | Same                               | ~600x faster for navigation queries    |
| Setup                         | Zero                               | Requires language server binary        |
| Non-TS files                  | Works everywhere                   | Language-specific only                 |

## Recommendation

**LSP is the better default** for this codebase due to:

1. **Path aliases everywhere** — grep cannot resolve `@/shared` → `apps/web/src/shared`
2. **Contract-first architecture** — `z.infer` chains require semantic type following
3. **Monorepo with 16 packages** — cross-workspace dependency analysis needs LSP

**Grep remains useful** for: file name patterns, string literals, env vars, config keys, TODOs, and non-TypeScript files.

## Claude Code Configuration

LSP is available via plugins. Configure with `.lsp.json` or install the TypeScript plugin:

```bash
claude plugin install typescript-lsp
npm install -g typescript-language-server typescript
```

Add to `CLAUDE.md`:

```markdown
When navigating code or finding definitions, prefer LSP-based tools
(goToDefinition, findReferences) over text-based grep searches.
```
