---
id: contributor-quickstart
type: guide
title: Contributor Quickstart
status: draft
trust: draft
summary: Fastest path from "I want to help" to "my change is live on canary"
read_when: First time contributing, or wanting the shortest path to a meaningful change
owner: cogni-dev
created: 2026-04-06
---

# Contributor Quickstart

> Fastest path: update a graph, see it on canary in 30 minutes.

## What You'll Change

The simplest meaningful contribution is a **graph package update** — add a tool, tweak a prompt, or create a new graph. Graphs are pure factories: no env reads, no side effects, no framework deps.

Three places graphs live:

| Package                      | What                            | Example                        |
| ---------------------------- | ------------------------------- | ------------------------------ |
| `packages/langgraph-graphs/` | Shared graphs                   | brain, browser, research, poet |
| `nodes/<node>/graphs/`       | Node-specific graphs            | poly-brain, resy-brain         |
| `packages/ai-tools/`         | Tool definitions used by graphs | web-search, knowledge-write    |

## The 9-Step Path

```bash
# 1. Branch from canary
git checkout -b feat/poly-brain-knowledge origin/canary

# 2. Make your change
#    Example: add knowledge_search tool to poly's brain graph
#    Edit: nodes/poly/graphs/src/graphs/poly-brain/tools.ts
#    → import { KNOWLEDGE_SEARCH_NAME } from "@cogni/ai-tools"
#    → add KNOWLEDGE_SEARCH_NAME to POLY_BRAIN_TOOL_IDS array

# 3. Build packages (THE gotcha — stale dist/ causes phantom errors)
pnpm packages:build

# 4. Validate locally
pnpm check:fast          # typecheck + lint + unit tests (~30s)

# 5. Full validation (once, before push)
pnpm check               # everything: arch, docs, format, tests (~2min)

# 6. Commit (hooks enforce checks automatically)
git add -A && git commit -m "feat(poly): add knowledge_search tool to brain graph"

# 7. Push (pre-push hook runs check:fast)
git push -u origin feat/poly-brain-knowledge

# 8. Create PR targeting canary
gh pr create --base canary --title "feat(poly): add knowledge_search to brain graph"

# 9. Watch the pipeline
gh pr checks <pr-number>
```

## The One Gotcha

**Always run `pnpm packages:build` before `pnpm check:fast`** when you change anything in `packages/` or `nodes/*/graphs/`. The typecheck reads `dist/*.d.ts` declarations — if they're stale from a previous build, you'll get phantom errors on code that's clearly correct.

## What Happens After Push

```
PR to canary
  → CI: typecheck + lint + unit + component tests        ~6 min
  → Review + approval → merge
    → Build Multi-Node: Docker images for all nodes       ~3 min
      → Promote: resolve digests, update k8s overlays     ~1 min
        → Deploy Infra: Compose services on canary VM     ~1 min
          → Verify: poll /readyz on all 3 nodes           ~1 min
            → E2E: Playwright smoke tests                 ~2 min
```

Your change is live at `https://test.cognidao.org` after verify passes.

## How to Confirm It's Live

- **Check agents list**: `curl https://test.cognidao.org/api/v1/ai/agents` — your graph should appear with updated tools
- **Check Grafana logs**: query `{namespace="cogni-canary"}` for your node's pod logs
- **Chat with it**: sign in at `https://test.cognidao.org`, start a chat, verify the new capability works

## Graph Rules (from langgraph-patterns-spec)

- **NO_LANGCHAIN_IN_SRC**: `@langchain/*` imports only allowed in `packages/langgraph-graphs/` and `nodes/*/graphs/` — never in `src/`
- **ENV_FREE_EXPORTS**: Graphs are pure factories. No `process.env`, no SDK instantiation
- **CATALOG_SINGLE_SOURCE_OF_TRUTH**: Export your graph from the catalog barrel (`src/graphs/index.ts`)
- **Pure tools**: Tool definitions in `packages/ai-tools/` — stateless, no side effects

## Full Lifecycle Guide

For the complete contributor workflow (claiming tasks, handling review feedback, CI troubleshooting), see the [contributor skill](/.claude/skills/contribute/SKILL.md) or [CONTRIBUTING.md](/CONTRIBUTING.md).
