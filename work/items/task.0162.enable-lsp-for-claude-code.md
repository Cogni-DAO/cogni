---
id: task.0162
type: task
title: Enable TypeScript LSP plugin for Claude Code
status: needs_implement
priority: 1
rank: 10
estimate: 1
summary: Configure the official typescript-lsp plugin so Claude Code uses semantic navigation (goToDefinition, findReferences) instead of grep-only for this monorepo.
outcome: Claude Code sessions in this repo automatically load the TypeScript language server and prefer LSP navigation over grep for type-aware queries.
spec_refs:
assignees: claude
credit:
project: proj.development-workflows
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-12
updated: 2026-03-12
labels: [tooling, agents, dx]
external_refs:
  - docs/research/grep-vs-lsp-analysis.md
---

# Enable TypeScript LSP plugin for Claude Code

## Context

Research spike `docs/research/grep-vs-lsp-analysis.md` concluded that LSP is the better default for this codebase due to path aliases (`@/*`), contract-first `z.infer` chains, and 16 workspace packages. Claude Code ships with an official `typescript-lsp` plugin that provides `goToDefinition`, `findReferences`, and automatic post-edit diagnostics — but it requires explicit opt-in.

Key numbers from the research and community benchmarks:

- ~600x faster warm navigation vs grep
- 23 precise call-sites vs 500+ noisy grep matches
- ~15 tokens per LSP lookup vs ~2,100 tokens for grep equivalent

## Requirements

- `typescript-language-server` binary is available in the project environment (via devDependencies or global install)
- The `typescript-lsp@claude-plugins-official` plugin is enabled at project scope in `.claude/settings.json`
- `CLAUDE.md` includes guidance for agents to prefer LSP tools (`goToDefinition`, `findReferences`) over grep for type-aware navigation, while still using grep for string literals, config keys, TODOs, and non-TS files
- The research doc `docs/research/grep-vs-lsp-analysis.md` status is updated from `draft` to `reviewed`

## Allowed Changes

- `.claude/settings.json` — add `enabledPlugins` and optional `env.ENABLE_LSP_TOOL`
- `CLAUDE.md` — add LSP navigation guidance (≤10 lines)
- `package.json` — add `typescript-language-server` to devDependencies
- `docs/research/grep-vs-lsp-analysis.md` — update frontmatter status
- `work/items/task.0162.enable-lsp-for-claude-code.md` — this file
- `work/projects/proj.development-workflows.md` — add task reference

## Plan

- [ ] Add `typescript-language-server` to devDependencies: `pnpm add -D typescript-language-server`
- [ ] Update `.claude/settings.json` to enable the plugin at project scope (merge into existing settings, preserve hooks):
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
- [ ] Add LSP guidance to `CLAUDE.md` under a new `## Code Navigation` heading:

  ```markdown
  ## Code Navigation

  This repo has the TypeScript LSP plugin enabled. When navigating code:

  - **Prefer LSP** (`goToDefinition`, `findReferences`, `hover`) for type-aware queries, following `z.infer` chains, resolving `@/*` path aliases, and cross-package references
  - **Use Grep/Glob** for string literals, env vars, config keys, TODOs, and non-TypeScript files
  ```

- [ ] Update `docs/research/grep-vs-lsp-analysis.md` frontmatter: `status: draft` → `status: reviewed`, `trust: draft` → `trust: reviewed`
- [ ] Add `task.0162` to `proj.development-workflows.md` roadmap table
- [ ] Run `pnpm check:docs` and fix any lint errors
- [ ] Commit and push

## Validation

**Command:**

```bash
pnpm check:docs
```

**Expected:** Clean pass, no errors.

**Command:**

```bash
cat .claude/settings.json | grep -q "typescript-lsp" && echo "PASS: plugin configured" || echo "FAIL"
```

**Expected:** `PASS: plugin configured`

**Command:**

```bash
grep -q "goToDefinition" CLAUDE.md && echo "PASS: LSP guidance in CLAUDE.md" || echo "FAIL"
```

**Expected:** `PASS: LSP guidance in CLAUDE.md`

**Manual verification:** Start a new Claude Code session in this repo. Run `/plugin` → Installed tab. Confirm `typescript-lsp` appears as enabled. If `typescript-language-server` binary is in PATH, the LSP server should start and provide diagnostics after file edits.

## Review Checklist

- [ ] **Work Item:** `task.0162` linked in PR body
- [ ] **Spec:** research doc referenced, no spec invariants violated
- [ ] **Tests:** no code tests needed (configuration-only change)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Research: `docs/research/grep-vs-lsp-analysis.md`
- Official plugin: `typescript-lsp@claude-plugins-official`
- Claude Code docs: https://code.claude.com/docs/en/discover-plugins

## Attribution

- Research spike: Claude (2026-03-11)
