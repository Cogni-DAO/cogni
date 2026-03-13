---
id: task.0162
type: task
title: Enable TypeScript LSP plugin for Claude Code
status: needs_merge
priority: 1
rank: 10
estimate: 1
summary: Configure the official typescript-lsp plugin so Claude Code gains semantic navigation (goToDefinition, findReferences, diagnostics) for this monorepo.
outcome: Claude Code sessions in this repo automatically load the TypeScript language server, gaining precise type-aware navigation alongside existing grep.
spec_refs:
assignees: claude
credit:
project: proj.development-workflows
branch: claude/grep-vs-lsp-analysis-cb4OM
pr:
reviewer:
revision: 1
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

Research spike `docs/research/grep-vs-lsp-analysis.md` concluded that LSP adds significant value for this codebase due to path aliases (`@/*`), contract-first `z.infer` chains, and 16 workspace packages. Claude Code ships with an official `typescript-lsp` plugin that provides `goToDefinition`, `findReferences`, and automatic post-edit diagnostics — but it requires explicit opt-in.

The LSP advantage is **precision, not speed** — ripgrep is already fast. LSP resolves path aliases, follows type inference chains, and returns only real call-sites instead of noisy text matches. Once the plugin is enabled, Claude Code automatically gains and uses LSP tools — no agent instructions needed.

## Requirements

- `typescript-language-server` binary is available in the project environment (via devDependencies)
- The `typescript-lsp@claude-plugins-official` plugin is enabled at project scope in `.claude/settings.json`
- The research doc `docs/research/grep-vs-lsp-analysis.md` status is updated from `draft` to `reviewed`

## Allowed Changes

- `.claude/settings.json` — add `enabledPlugins` and `env.ENABLE_LSP_TOOL`
- `package.json` — add `typescript-language-server` to devDependencies
- `docs/research/grep-vs-lsp-analysis.md` — update frontmatter status
- `work/items/task.0162.enable-lsp-for-claude-code.md` — this file
- `work/projects/proj.development-workflows.md` — already updated

## Plan

- [x] Add `typescript-language-server` to devDependencies: `pnpm add -D typescript-language-server`
- [x] Update `.claude/settings.json` to enable the plugin at project scope (merge into existing settings, preserve hooks)
- [x] Update `docs/research/grep-vs-lsp-analysis.md` frontmatter: `status: draft` → `status: active`, `trust: draft` → `trust: reviewed`, add `verified: 2026-03-12`
- [x] Run `pnpm check:docs` and fix any lint errors
- [x] Commit and push

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
