# AGENTS.md System & Documentation Review

**Date:** 2026-03-07
**Scope:** Root AGENTS.md, 143 subdirectory AGENTS.md files, architecture.md, CLAUDE.md, skills, and lifecycle commands
**Method:** Codebase analysis + external research on agentic coding best practices (2025-2026)

---

## By the Numbers

| Metric                                | Value      |
| ------------------------------------- | ---------- |
| Total AGENTS.md files                 | 143        |
| Total AGENTS.md lines                 | 12,761     |
| Average lines per file                | ~90        |
| Required template sections            | 11         |
| Root AGENTS.md                        | 132 lines  |
| Architecture spec                     | 562 lines  |
| Skills (slash commands)               | 31         |
| Files with review date > 4 months old | 20+        |
| Oldest `Last reviewed` date           | 2025-01-11 |

---

## 1. OUTDATED

### 1a. Stale Review Dates

20+ files have `Last reviewed` dates from Nov 2025 or earlier. One file is 14 months stale (2025-01-11). The `Last reviewed` field is pure ceremony — nobody reviews 143 files on a regular cadence. It wastes a line per file and creates false confidence.

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
- `Change Protocol` — nearly identical across all 143 files ("bump Last reviewed date")
- `Dependencies → External: vitest` — discoverable from package.json
- `Ports (optional)` with "Uses ports: none / Implements ports: none" — 3 wasted lines

**Estimated waste:** ~5,000 lines of boilerplate across 119 subdirectory files.

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

### 2d. Root Pointer Section (35+ Links)

Lines 46-98 of root AGENTS.md list 35+ documentation links grouped loosely. Agents don't need all 35 on every boot. The top 5-7 frequently-referenced docs would suffice; the rest belong in a reference index.

---

## 3. MISSING

### 3a. CLAUDE.md → AGENTS.md Unification

`CLAUDE.md` is a 3-line redirect to `AGENTS.md`. Claude Code reads CLAUDE.md first on every boot. This indirection adds a read step. **Symlink or merge.**

Research confirms: Claude Code loads CLAUDE.md; Copilot/Cursor/Gemini/Codex load AGENTS.md. A symlink bridges both ecosystems.

### 3b. "Common Mistakes" Section

No AGENTS.md captures the top mistakes agents actually make. High-value additions:

```markdown
## Common Mistakes (Do Not)

- Import `adapters` from `features` or `core`
- Use `console.log` (use Pino server / clientLogger browser)
- Create manual type definitions for contract shapes (use z.infer)
- Skip `pnpm check` before commit
- Create files in wrong architectural layer
- Modify contracts without updating dependent routes/services
```

Research confirms: _"Document what the agent gets wrong, not everything you know. Build AGENTS.md iteratively through trial and error."_

### 3c. Quick-Start Block (< 20 Lines)

Missing a "TL;DR for agents" at the top of root AGENTS.md. Agents doing quick tasks shouldn't parse 132 lines.

### 3d. Error Recovery Guidance

When `pnpm check` fails, agents have no guidance on diagnosis:

- How to read dependency-cruiser violation output
- Common lint errors and fixes
- How to debug arch test failures

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

| #   | Change                                                                                                                                | Impact                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | **Symlink `CLAUDE.md → AGENTS.md`**                                                                                                   | Eliminates boot indirection                           |
| 2   | **Slim subdirectory template to ~40 lines.** Make Routes/CLI/Env, Change Protocol, and Dependencies optional. Collapse "none" fields. | Cuts ~5,000 lines of boilerplate                      |
| 3   | **Remove `[ ]` phantom entries from architecture.md**                                                                                 | Prevents agent hallucination about non-existent files |
| 4   | **Remove `Last reviewed` date requirement.** Use git blame instead.                                                                   | Removes ceremony from 143 files                       |
| 5   | **Add "Common Mistakes" section to root AGENTS.md** (8-10 bullets)                                                                    | Highest-value agent context                           |

### P1 — Significant Improvement

| #   | Change                                                                                                                                                                                                                                                                                                                                                                  | Impact                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 6   | **Split architecture.md:** ~100-line architecture concepts doc + separate directory-manifest.md for the tree                                                                                                                                                                                                                                                            | Agents rarely need both; saves ~300 tokens when reading arch |
| 7   | **Trim root AGENTS.md pointers to top ~10.** Move rest to `docs/reference/SPEC_INDEX.md`                                                                                                                                                                                                                                                                                | Reduce root context by ~40 lines                             |
| 8   | **Delete AGENTS.md for trivially obvious directories.** Candidates: `tests/unit/core/`, `tests/unit/features/`, `tests/unit/shared/`, `tests/unit/bootstrap/`, `src/adapters/test/ai/`, `src/adapters/test/repo/`, `src/bootstrap/ai/`, `src/bootstrap/capabilities/`, `src/features/setup/components/`, `src/adapters/server/time/`, `src/adapters/server/governance/` | ~15-20 files removable without signal loss                   |
| 9   | **Add `/fix-lint` skill**                                                                                                                                                                                                                                                                                                                                               | Automates repetitive agent task                              |
| 10  | **Add machine-readable checklists to feature-development.md**                                                                                                                                                                                                                                                                                                           | Reduces agent mistakes when creating new features            |

### P2 — Structural Improvements

| #   | Change                                                                                                              | Impact                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 11  | **Derive Boundaries from `.dependency-cruiser.cjs`** instead of duplicating in each AGENTS.md                       | Eliminates drift between docs and enforcement                   |
| 12  | **Add `/context <dir>` skill**                                                                                      | Automates AGENTS.md chain reading                               |
| 13  | **Auto-generate subdirectory AGENTS.md** from code analysis                                                         | Most sections (exports, imports, ports) are derivable from code |
| 14  | **Add error recovery guidance**                                                                                     | Unblocks agents when `pnpm check` fails                         |
| 15  | **Review skills for consolidation**: merge `/document` into `/closeout`, integrate `/eval` checks into `/implement` | 31 skills is a lot; some overlap                                |

---

## 5. TOKEN COST ANALYSIS

| Context                               | Lines  | Est. Tokens | When Loaded                    |
| ------------------------------------- | ------ | ----------- | ------------------------------ |
| Root AGENTS.md                        | 132    | ~600        | Every session                  |
| CLAUDE.md redirect                    | 3      | ~20         | Every session                  |
| Architecture spec                     | 562    | ~3,500      | Most implement/design sessions |
| Avg subdirectory AGENTS.md (per file) | 90     | ~400        | 1-4 files per task             |
| Typical agent AGENTS.md context load  | ~400   | ~2,000      | Per task                       |
| All 143 AGENTS.md files combined      | 12,761 | ~55,000     | Never (but stored in repo)     |

**Estimated savings from P0 changes:** ~30-40% reduction in AGENTS.md context per session.

---

## 6. RESEARCH SOURCES

- [Best Practices for Claude Code - Anthropic](https://code.claude.com/docs/en/best-practices)
- [How to Write a Great AGENTS.md - GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
- [Steering AI Agents in Monorepos - Datadog](https://dev.to/datadog-frontend-dev/steering-ai-agents-in-monorepos-with-agentsmd-13g0)
- [Trail of Bits claude-code-config](https://github.com/trailofbits/claude-code-config)
- [Context Rot - Chroma Research](https://research.trychroma.com/context-rot)
- [Context Engineering for Coding Agents - Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [AGENTS.md Token Optimization Guide - SmartScope](https://smartscope.blog/en/generative-ai/claude/agents-md-token-optimization-guide-2026/)
- [Claude Skills and CLAUDE.md Guide - Gend.co](https://www.gend.co/blog/claude-skills-claude-md-guide)
