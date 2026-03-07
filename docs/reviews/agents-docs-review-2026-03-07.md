# AGENTS.md System & Documentation Review

**Date:** 2026-03-07
**Scope:** Root AGENTS.md, 142 subdirectory AGENTS.md files, architecture.md, CLAUDE.md, skills, and lifecycle commands
**Method:** Codebase analysis, workflow skill audit, external research on agentic coding best practices (2025-2026)

---

## By the Numbers

| Metric                                | Value      |
| ------------------------------------- | ---------- |
| Total AGENTS.md files                 | 142        |
| Total AGENTS.md lines                 | ~12,700    |
| Average lines per file                | ~90        |
| Required template sections            | 11         |
| Root AGENTS.md                        | 132 lines  |
| Architecture spec                     | 562 lines  |
| Skills (slash commands)               | 31         |
| Files with review date > 4 months old | 20+        |
| Oldest `Last reviewed` date           | 2025-01-11 |

---

## 0. WHY SUBDIRECTORY AGENTS.md FILES ARE LOAD-BEARING

Before any prune recommendations: these files are **critical infrastructure**, not optional docs.

### Every Workflow Skill Reads Them

| Skill                    | Instruction                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `/implement`             | "Every AGENTS.md in the file path tree of files you'll touch (start at root, descend)"   |
| `/eval`                  | "Find every AGENTS.md file that is in the file path tree of the files you were editing"  |
| `/review-design`         | "find every AGENTS.md in the file path tree of the files being changed"                  |
| `/review-implementation` | "find every AGENTS.md in the file path tree of the files being changed"                  |
| `/design`                | "All AGENTS.md files in relevant paths"                                                  |
| `/document`              | "Every subdirectory NEEDS to have a AGENTS.md file. Create one from template if missing" |
| `/closeout`              | Checks if public exports/routes/env/ports/boundaries changed → AGENTS.md update needed   |

### The Boundaries Section Prevents Architectural Violations

Each subdirectory AGENTS.md has a `may_import` / `must_not_import` block. This is the primary mechanism telling agents what imports are allowed. Even seemingly "trivial" files like `tests/unit/core/AGENTS.md` encode a critical constraint: `may_import: ["core"]` — preventing tests from accidentally importing adapters.

### Content Is Genuinely Area-Specific, Not Duplicated

| Content Type                                   | Root | Subdirs | Notes                                              |
| ---------------------------------------------- | ---- | ------- | -------------------------------------------------- |
| Mission/Principles                             | Yes  | No      | Root only; subdirs point back                      |
| **Boundaries (layer, may/must_not import)**    | No   | Yes     | Area-specific; critical for agents                 |
| **Public Surface (Exports, Routes, Env, API)** | No   | Yes     | Area-specific; agents verify changes against this  |
| **Responsibilities (does/does-not)**           | No   | Yes     | Area-specific; prevents scope creep in reviews     |
| **Ports (Uses/Implements)**                    | No   | Yes     | Area-specific; connects port contracts to adapters |
| Notes (implementation gotchas)                 | Some | Yes     | Subdirs have unique invariants per area            |

**Verdict:** The FILES must stay. The BOILERPLATE within them can be pruned.

---

## 1. OUTDATED

### 1a. Stale Review Dates

20+ files have `Last reviewed` dates from Nov 2025 or earlier. One file is 14 months stale (2025-01-11). The `Last reviewed` field is pure ceremony — nobody reviews 142 files on a regular cadence. It wastes a line per file and creates false confidence.

### 1b. Architecture Spec: Phantom Entries

`docs/spec/architecture.md` lines 265-343 contain `[ ]` checkboxes for **files that do not exist**:

- `src/features/auth/`, `src/features/proposals/` — not implemented
- `src/ports/wallet.port.ts`, `apikey.port.ts`, `ratelimit.port.ts`, `rng.port.ts` — not implemented
- `src/adapters/auth/siwe.adapter.ts`, `apikey/drizzle.repo.ts`, `ratelimit/db-bucket.adapter.ts` — not implemented
- `src/bootstrap/config.ts` — not implemented

These actively mislead agents into thinking these files exist or should be created.

### 1c. Dead References in AGENTS.md Files

- `features/ai/AGENTS.md` line 60: mentions `runners/` and `graphs/` as "DELETED" — negative knowledge that should be removed entirely
- Root AGENTS.md points to `docs/archive/MVP_DELIVERABLES.md` and `docs/archive/DOCS_ORGANIZATION_PLAN.md` as active pointers
- Root AGENTS.md pointer section has 35+ links — many to specs that haven't changed in months

### 1d. Architecture Spec Status

The architecture spec header says `trust: draft` and `status: active` — contradictory signals. It also says `Proof-of-Concept Scope` (line 47) while documenting a system well past PoC.

---

## 2. OVERLY VERBOSE — PRUNE CANDIDATES

### 2a. Template Bloat (Biggest Issue)

The subdirectory template (`docs/templates/agents_subdir_template.md`) mandates **11 required sections** with strict ordering enforced by CI. For a `tests/unit/features/` directory, this produces 70 lines to communicate ~8 lines of actual value.

**Sections that are pure noise in most files:**

- `Routes: none, CLI: none, Env: none` — if all "none", the section wastes 4 lines
- `Change Protocol` — nearly identical across all 142 files ("bump Last reviewed date")
- `Dependencies → External: vitest` — discoverable from package.json
- `Ports (optional)` with "Uses ports: none / Implements ports: none" — 3 wasted lines

**Recommended template structure (~40 lines):**

Required sections: Purpose, Boundaries, Public Surface, Responsibilities, Notes
Optional sections (include only when non-empty): Routes, CLI, Env/Config, Ports, Dependencies, Change Protocol, Usage

This preserves all load-bearing content while cutting ~5,000 lines of "none" boilerplate.

**Research finding (Anthropic best practices):** _"For each line, ask: would removing this cause the agent to make mistakes? If not, cut it."_

**Research finding (Chroma):** Irrelevant tokens actively degrade agent quality through "context rot" — more context does not mean better comprehension.

### 2b. Architecture Spec at 562 Lines

The directory tree with checkboxes (lines 116-440) is ~320 lines — 57% of the document. It duplicates:

- Root AGENTS.md (Usage section)
- `.dependency-cruiser.cjs` (enforced import rules)
- `docs/guides/feature-development.md`
- Individual directory AGENTS.md files

### 2c. Context Accumulation Problem

When an agent works in `src/features/ai/chat/`, it reads the chain: root (132 lines) → `src/` (90) → `features/` (67) → `features/ai/` (157) → `features/ai/chat/` (164) = **610+ lines** of AGENTS.md context before writing a single line of code.

Slimming the template (2a) would reduce this to ~350-400 lines — a meaningful improvement but still substantial. The chain is inherent to the hierarchical model; the fix is making each file leaner, not removing files.

### 2d. Root Pointer Section (35+ Links)

Lines 46-98 of root AGENTS.md list 35+ documentation links grouped loosely. Agents don't need all 35 on every boot. The top 5-7 frequently-referenced docs would suffice; the rest belong in a reference index.

---

## 3. MISSING

### 3a. CLAUDE.md → AGENTS.md Unification

`CLAUDE.md` is a 3-line redirect to `AGENTS.md`. Claude Code reads CLAUDE.md first on every boot. This indirection adds a read step. **Symlink or merge.**

Research confirms: Claude Code loads CLAUDE.md; Copilot/Cursor/Gemini/Codex load AGENTS.md. A symlink bridges both ecosystems.

### 3b. Common Mistakes Guide (Separate Document)

No documentation captures the top mistakes agents actually make. This is the highest-value missing content.

**Recommendation: Create `docs/guides/common-mistakes.md`** — not inline in root AGENTS.md. This content is destined to grow as patterns emerge from agent sessions. Root AGENTS.md should have a 1-line pointer only.

Initial content for `docs/guides/common-mistakes.md`:

```markdown
# Common Agent Mistakes

## Architecture Violations

- Import `adapters` from `features` or `core` (layer boundary violation)
- Create files in wrong architectural layer
- Import `@langchain/*` from `src/**` (must be in `packages/langgraph-graphs/`)

## Contract & Type Mistakes

- Create manual type definitions for contract shapes (use `z.infer`)
- Modify contracts without updating dependent routes/services
- Skip contract-first: always update `src/contracts/*.contract.ts` before touching routes

## Tooling Misunderstandings

- Use `console.log` (use Pino server logger / clientLogger for browser)
- Skip `pnpm check` before commit
- Treat `pnpm check` as comprehensive — it is NOT:
  - Takes 5-10 minutes (not a quick lint)
  - Does NOT run `pnpm build` (Next.js production build)
  - Does NOT run stack/component/integration tests
  - DOES run: packages:build, typecheck, lint, format, unit tests, arch enforcement, docs check
  - For full CI parity: use `pnpm check:full` (much longer, needs Docker)
- Assume `pnpm check` passing means "everything works" — it validates code quality, not runtime behavior

## Documentation Mistakes

- Restate root AGENTS.md policies in subdirectory files
- Add "none" sections that add no information
- Write AGENTS.md for behavior details (keep those in file headers)
```

### 3c. Quick-Start Block (< 20 Lines)

Missing a "TL;DR for agents" at the top of root AGENTS.md. Agents doing quick tasks shouldn't parse 132 lines.

### 3d. Error Recovery Guidance

When `pnpm check` fails, agents have no guidance on diagnosis:

- How to read dependency-cruiser violation output
- Common lint errors and fixes
- How to debug arch test failures

This could live in `docs/guides/common-mistakes.md` as a "When Things Fail" section, or as a separate troubleshooting appendix.

### 3e. Machine-Readable Checklists for Common Tasks

`docs/guides/feature-development.md` is written as a human narrative. Missing: a machine-optimized checklist:

```markdown
## New API Endpoint Checklist

1. Create `src/contracts/<feature>.<action>.v1.contract.ts`
2. Create `src/features/<feature>/services/<action>.ts`
3. Create `src/app/api/v1/<feature>/<action>/route.ts`
4. Create/update `src/adapters/server/...` if new port needed
5. Create `tests/contract/<feature>.<action>.contract.ts`
6. Update `<feature>/AGENTS.md` public surface
```

### 3f. Missing Skills

| Skill            | Purpose                                     | Rationale                                                 |
| ---------------- | ------------------------------------------- | --------------------------------------------------------- |
| `/fix-lint`      | `pnpm lint:fix && pnpm format`              | Agents do this manually in every implement/closeout cycle |
| `/validate`      | Pre-flight "am I about to break something?" | Quick arch+lint+type check before commit                  |
| `/context <dir>` | Read AGENTS.md chain for target dir         | Agents currently read 3-5 files manually                  |
| `/diff-review`   | Self-review of current changes              | Catch mistakes before commit                              |

### 3g. Skill-AGENTS.md Coordination

Skills reference AGENTS.md extensively (`/implement` says "read every AGENTS.md in the file path tree") but there's no optimization for this. Consider a `/context` skill or pre-computed "directory profile" that summarizes the chain.

### 3h. Hooks for Guarantees

Research finding: _"CLAUDE.md is advisory; hooks are deterministic. Use hooks for anything that must happen without exception."_

Currently you have two SessionStart hooks (git config + pnpm install). Missing candidates:

- Pre-commit hook enforcing `pnpm check` (already in .husky, but worth validating)
- PostToolUse hook that warns if an agent creates a file in a wrong layer

---

## 4. SUGGESTED CHANGES (Prioritized)

### P0 — High Impact, Low Effort

| #   | Change                                                                                                                                | Impact                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | **Symlink `CLAUDE.md → AGENTS.md`**                                                                                                   | Eliminates boot indirection                            |
| 2   | **Slim subdirectory template to ~40 lines.** Make Routes/CLI/Env, Change Protocol, and Dependencies optional. Collapse "none" fields. | Cuts ~5,000 lines of boilerplate; preserves all signal |
| 3   | **Remove `[ ]` phantom entries from architecture.md**                                                                                 | Prevents agent hallucination about non-existent files  |
| 4   | **Remove `Last reviewed` date requirement.** Use git blame instead.                                                                   | Removes ceremony from 142 files                        |
| 5   | **Create `docs/guides/common-mistakes.md`** with pointer from root AGENTS.md. Include `pnpm check` scope clarification.               | Highest-value agent context; scalable as list grows    |

### P1 — Significant Improvement

| #   | Change                                                                                          | Impact                                                       |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 6   | **Split architecture.md:** ~100-line concepts doc + separate directory-manifest.md for the tree | Agents rarely need both; saves ~300 tokens when reading arch |
| 7   | **Trim root AGENTS.md pointers to top ~10.** Move rest to `docs/reference/SPEC_INDEX.md`        | Reduce root context by ~40 lines                             |
| 8   | **Add `/fix-lint` skill**                                                                       | Automates repetitive agent task                              |
| 9   | **Add machine-readable checklists to feature-development.md**                                   | Reduces agent mistakes when creating new features            |
| 10  | **Add error recovery / troubleshooting to common-mistakes.md**                                  | Unblocks agents when `pnpm check` fails                      |

### P2 — Structural Improvements

| #   | Change                                                                                                              | Impact                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 11  | **Derive Boundaries from `.dependency-cruiser.cjs`** instead of duplicating in each AGENTS.md                       | Eliminates drift between docs and enforcement                   |
| 12  | **Add `/context <dir>` skill**                                                                                      | Automates AGENTS.md chain reading                               |
| 13  | **Auto-generate subdirectory AGENTS.md** from code analysis                                                         | Most sections (exports, imports, ports) are derivable from code |
| 14  | **Review skills for consolidation**: merge `/document` into `/closeout`, integrate `/eval` checks into `/implement` | 31 skills is a lot; some overlap                                |

### Removed from Previous Version

| Previous Suggestion                                                 | Why Removed                                                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "Delete AGENTS.md for trivially obvious directories (~15-20 files)" | Wrong. Even `tests/unit/core/AGENTS.md` has a load-bearing `may_import` boundary. `/document` requires every subdir to have one. |
| "Add Common Mistakes section inline to root AGENTS.md"              | Refined: separate doc (`docs/guides/common-mistakes.md`) — this content will grow and shouldn't bloat root.                      |

---

## 5. `pnpm check` SCOPE CLARIFICATION

This deserves special attention because agents routinely misunderstand what `pnpm check` validates.

**What `pnpm check` runs** (via `scripts/check-fast.sh`):

- `pnpm packages:build` — build workspace packages
- `pnpm typecheck` — TypeScript compiler check
- `pnpm lint` — ESLint + Biome
- `pnpm format:check` — Prettier
- `pnpm test:core` — unit tests (core, features, shared)
- `pnpm test:packages:local` — package unit tests
- `pnpm test:services:local` — service unit tests
- `pnpm check:docs` — AGENTS.md documentation lint
- `pnpm check:root-layout` — root layout validation
- `pnpm arch:check` — dependency-cruiser architecture enforcement

**What `pnpm check` does NOT run:**

- `pnpm build` (Next.js production build) — a change can pass `check` but fail `build`
- Component tests (`pnpm test:component`) — requires testcontainers
- Stack tests (`pnpm test:stack:*`) — requires running server + DB
- E2E tests (`pnpm e2e`) — requires full Docker stack
- Integration tests — no external service connectivity

**Runtime:** 5-10 minutes. Not a quick lint.

**`pnpm check:full`** for CI parity — runs Docker builds + stack tests. Much longer.

---

## 6. TOKEN COST ANALYSIS

| Context                               | Lines   | Est. Tokens | When Loaded                    |
| ------------------------------------- | ------- | ----------- | ------------------------------ |
| Root AGENTS.md                        | 132     | ~600        | Every session                  |
| CLAUDE.md redirect                    | 3       | ~20         | Every session                  |
| Architecture spec                     | 562     | ~3,500      | Most implement/design sessions |
| Avg subdirectory AGENTS.md (per file) | 90      | ~400        | 1-4 files per task             |
| Typical agent AGENTS.md context load  | ~400    | ~2,000      | Per task                       |
| All 142 AGENTS.md files combined      | ~12,700 | ~55,000     | Never (but stored in repo)     |

**Estimated savings from P0 changes:** ~25-35% reduction in per-file AGENTS.md context (template slim), plus qualitative improvement from common-mistakes guide preventing wasted cycles.

---

## 7. RESEARCH SOURCES

- [Best Practices for Claude Code - Anthropic](https://code.claude.com/docs/en/best-practices)
- [How to Write a Great AGENTS.md - GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
- [Steering AI Agents in Monorepos - Datadog](https://dev.to/datadog-frontend-dev/steering-ai-agents-in-monorepos-with-agentsmd-13g0)
- [Trail of Bits claude-code-config](https://github.com/trailofbits/claude-code-config)
- [Context Rot - Chroma Research](https://research.trychroma.com/context-rot)
- [Context Engineering for Coding Agents - Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [AGENTS.md Token Optimization Guide - SmartScope](https://smartscope.blog/en/generative-ai/claude/agents-md-token-optimization-guide-2026/)
- [Claude Skills and CLAUDE.md Guide - Gend.co](https://www.gend.co/blog/claude-skills-claude-md-guide)
