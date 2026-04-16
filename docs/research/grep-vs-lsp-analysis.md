---
id: grep-vs-lsp-analysis
type: research
title: "Research: Grep vs LSP Analysis for Claude Code Navigation"
status: active
trust: reviewed
summary: "Comparison of grep vs LSP search strategies for navigating a strict TypeScript monorepo with path aliases, Zod contracts, and 16 workspace packages."
read_when: Configuring Claude Code search behavior, evaluating LSP plugins, or optimizing codebase navigation.
owner: claude
verified: 2026-03-12
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

The LSP advantage is **precision, not speed** — ripgrep is already fast (milliseconds). LSP provides semantic understanding that text search cannot.

| Dimension                     | Grep                               | LSP                                    |
| ----------------------------- | ---------------------------------- | -------------------------------------- |
| Path alias resolution (`@/*`) | Literal strings only               | Resolves aliases correctly             |
| Following `z.infer` chains    | Cannot cross type boundaries       | Follows type inference end-to-end      |
| Cross-package references      | Must search each package           | Understands workspace dependency graph |
| Generic/utility types         | False positives on partial matches | Semantic understanding                 |
| Speed                         | Fast (ripgrep, milliseconds)       | Fast once warm; slower cold start      |
| Precision                     | Text matches (noisy)               | Semantic matches (exact)               |
| Setup                         | Zero                               | Requires language server binary        |
| Non-TS files                  | Works everywhere                   | Language-specific only                 |

## Recommendation

**LSP complements grep** for this codebase due to:

1. **Path aliases everywhere** — grep cannot resolve `@/shared` → `apps/operator/src/shared`
2. **Contract-first architecture** — `z.infer` chains require semantic type following
3. **Monorepo with 16 packages** — cross-workspace dependency analysis needs LSP

**Grep remains the right tool** for: file name patterns, string literals, env vars, config keys, TODOs, and non-TypeScript files.

## Claude Code Configuration

Enable the official TypeScript LSP plugin at project scope in `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "typescript-lsp@claude-plugins-official": true
  },
  "env": {
    "ENABLE_LSP_TOOL": "1"
  }
}
```

Ensure the binary is available (add to devDependencies or install globally):

```bash
pnpm add -D typescript-language-server
```

Once enabled, Claude Code automatically gains and uses LSP tools — no explicit agent instructions needed.
