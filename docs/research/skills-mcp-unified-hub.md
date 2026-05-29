---
id: skills-mcp-unified-hub
type: research
title: "Unifying agent skills + dolt knowledge behind a 1-URL MCP server"
status: draft
trust: draft
summary: "How to converge Cogni's two filesystem skill trees (.claude/skills, .openclaw/skills, .agents/skills) into one co-located-with-code layout, synced into the per-node dolt knowledge hub, and served to any external agent (Claude Code, OpenClaw, Codex, Cursor) over a single MCP URL. Models the pattern Anthropic itself uses for hosted Skills: filesystem-authored, registry-stored, filesystem-rendered at runtime."
read_when: Designing how external agents discover Cogni skills/knowledge, planning the operator MCP server, deciding how skills relate to the dolt knowledge hub, deduplicating the three skill trees, or evaluating Anthropic Skills API adoption.
owner: derekg1729
created: 2026-05-29
verified:
tags:
  [
    skills,
    mcp,
    knowledge,
    dolt,
    agent-onboarding,
    operator,
    anthropic-skills,
    co-location,
  ]
external_refs:
  - spike.5003
---

# Research: Unifying agent skills + dolt knowledge behind a 1-URL MCP server

> spike: spike.5003 | date: 2026-05-29 (rev 2 — after pushback that v1 false-dichotomized "git OR dolt")

## Question

Cogni has three filesystem skill trees, no MCP server, knowledge behind REST + bearer. Industry has converged on (a) Anthropic Agent Skills format and (b) one URL → MCP for skills + knowledge (Anthropic's own Skills API, PromptLayer Skill Collections, skillsmp, mcp.run, Mintlify, Inkeep). Design the convergence: where do skills physically live, how do they relate to the dolt knowledge hub, and how does any external agent connect with one line of config?

Three sub-questions:

1. **Substrate**: where is the source of truth for a skill — git, dolt, or both with one canonical?
2. **Layout**: how do we get out of "all skills at `.claude/skills/` root" and co-locate skills with the code they describe, without breaking existing harnesses?
3. **Surface**: what does the 1-URL MCP server actually expose, with what auth?

## Context

### What exists today (verified)

**Three skill trees, two functional categories, almost zero real duplication.**

| Tree | Count | Frontmatter | Purpose | Loaded by |
|---|---|---|---|---|
| `.claude/skills/` | 29 | `name`, `description` | Situational expertise — auto-loaded when relevant | Claude Code relevance judge |
| `.openclaw/skills/` | 37 | `description`, `user-invocable: true` | Lifecycle commands (`/research`, `/commit`, `/task`, `/triage`, …) | OpenClaw runtime + Claude Code slash-commands |
| `.agents/skills/` | 1 (`skill-creator`) | `name`, `description` | Shared bootstrap | symlinked from `.claude/skills/skill-creator` |

The two big trees are **disjoint, not redundant.** The only byte-identical duplicate across trees is `ui-ux-pro-max` (16,221 bytes both copies, not symlinked). The first-pass framing of "deduplicate the three trees" was wrong — the real work is **classification + co-location**, not deletion.

**OpenClaw skill discovery** (`services/sandbox-openclaw/openclaw-gateway.json:268`):
```json
"skills": { "load": { "extraDirs": ["/repo/current/.openclaw/skills"] } }
```
`extraDirs` is already an array — multiple roots are supported, just unused.

**Claude Code skill discovery** walks *into* subdirectories — `packages/frontend/.claude/skills/` is auto-discovered when editing files under `packages/frontend/`. Has a 15k-char description budget (visible via `/context`). **Co-location is a Claude-Code-native pattern**, not something we have to invent.

**`.claude/skills/` is baked into 3 architectural touchpoints** — renaming has blast radius:
- `nodes/operator/app/src/app/.well-known/agent.json/route.ts:70` — `validationSkill: ".claude/skills/validate-candidate"`
- `.github/workflows/ci.yaml:86,139` — single-node-scope policy whitelist
- `packages/repo-spec/src/accessors.ts` — classifier `startsWith(".claude/skills/")`

**Knowledge hub** (`packages/knowledge-base/src/schema.ts:42-146`, `nodes/operator/packages/doltgres-schema/src/knowledge.ts:38-90`): `domains`, `knowledge` (atomic claims with extensible `entry_type` — no `skill` type today), `citations` DAG, `sources`, plus `knowledge_contributions` + `knowledge_contribution_commits` (branched submissions with provenance). REST surface `/api/v1/knowledge` + `/contributions/*`. Bearer agents write to `contrib/*`; humans merge to main.

**MCP today**: cogni is MCP-consumer-ready (`packages/langgraph-graphs/src/runtime/mcp/client.ts`), MCP-server-stubbed (`nodes/node-template/app/src/mcp/server.stub.ts` throws). Prior research `docs/research/mcp-production-deployment-patterns.md` already settled auth direction (decoupled resource server, RFC 9728/8707).

### What's actually being built in the market (commercial, not strawmen)

| Product | Storage model | How agents connect | Notes |
|---|---|---|---|
| **Anthropic Skills API** (`/v1/skills`) | **Workspace-scoped registry, materialized to VM filesystem at runtime.** Pre-built skills bundled; custom skills uploaded. | `container: { skills: [{ skill_id, version }] }` in Messages API | **This is the pattern Anthropic itself ships.** DB-backed + filesystem-rendered. claude.ai / API / Claude Code don't sync — three separate stores. Beta headers: `code-execution-2025-08-25`, `skills-2025-10-02`, `files-api-2025-04-14`. |
| **PromptLayer Skill Collections** | DB-backed, versioned, SDK pulls into `.claude/`/`.agents/` | SDK call | Closest commercial fit to "dolt source of truth, filesystem at runtime". |
| **skillsmp.com** | Catalog of 1.2M+ SKILL.md, security-scanned | MCP server (`skillsmp-mcp-server`) — semantic search + install | Real and significant. |
| **skillhub.club** | 7K+ skills mirrored from GitHub (≥2 stars) | Desktop manager | Git pull-through, not DB. |
| **mcp.run** | Wasm artifacts in managed registry | Session URL via `MCP_RUN_SESSION_ID` | Registry-backed (artifact, not git pull). |
| **Continue Hub** (`hub.continue.dev`) | Service-backed registry of assistants/rules/prompts | Continue client install | Registry pattern. |
| **skillsovermcp.com** | **Stateless proxy** — GitHub fetch per request | `https://mcp.skillsovermcp.com/mcp/<owner>/<repo>` | <40ms median fetch; public repos only. |
| **bobmatnyc/mcp-skillset** (OSS) | Vector + knowledge-graph hybrid | MCP server | Only true RAG-over-skills hit in survey. |
| **Mintlify / Cloudflare AutoRAG / Inkeep** | Their own KB | One MCP URL → `search_*` + `read_*` tools | Docs-as-MCP precedent for the 1-URL UX. |

**Two storage patterns dominate among the products that actually scaled**: (a) **DB-backed registry + filesystem-rendered at runtime** (Anthropic, PromptLayer, mcp.run), and (b) **stateless git pull-through** (skillsovermcp). The aggregators (skillhub, claudeskills, agentskills.io) are git pull-through. The proxies-as-product (skillsovermcp) are git pull-through. The platforms that authored the category (Anthropic, PromptLayer) chose DB-backed + filesystem render. **Cogni should follow the platforms, not the aggregators.**

> **Note on what I couldn't confirm**: `skillset.dev`, `skills.dev`, `skillsforge.ai` — no live products found. Pieces / PromptHub have no shipped skill-as-MCP play.

### What v1 of this doc got wrong

Stated "git OR dolt" as a binary and rejected dolt as Option B. That was a strawman: I framed Option B as "skills MIGRATE INTO dolt, git copies deleted." The actual interesting design — and the one Anthropic itself ships — is **dual: git is the authoring substrate, dolt is the served/indexed substrate, filesystem is rendered at runtime**. With that frame, Option B and Option A converge.

## Findings

### Finding 1 — Skills and knowledge are the same data shape; today they live apart for accidental reasons

A skill is a markdown document with frontmatter (`name`, `description`, optional metadata like `user-invocable`), a body, and possibly referenced assets. A `knowledge` row is a markdown body with structured metadata (`title`, `entry_type`, `tags`, `source_ref`, `source_node`, `confidence_pct`). The only missing piece in the `knowledge` schema for skills is **`entry_type: skill`**, which is just a new value in a free-text column.

Once skills are rows in `knowledge`, everything in the knowledge hub applies to them for free: domains, citations DAG, confidence scores, source provenance, branched contributions, principal_id audit, source_node filtering, future vector search. This is what the `knowledge-syntropy-expert` skill describes when it talks about "the codified mind" — skills *are* knowledge.

### Finding 2 — Git as write substrate, dolt as read substrate, filesystem as render target

The "git OR dolt" framing dissolves once you separate **authoring**, **storage**, and **runtime delivery**:

- **Authoring**: SKILL.md in git, edited in a PR, reviewed by humans. PRs are the right unit for skill change-management — diff review, comments, blocking on CI. Dolt's branched contribution flow is parallel but **heavier than git PRs** for the typical "fix a typo / clarify wording" case. Keep PRs as the authoring path.
- **Storage / index**: every SKILL.md synced into the `knowledge` table on merge/deploy. Now there's a queryable read surface with all the knowledge-hub enrichment (tags, source_node, confidence, citations).
- **Runtime delivery**: local Claude Code reads filesystem directly (zero-latency, no MCP round-trip for laptops). Remote agents — anywhere — connect to the MCP URL and get the same skill rendered from dolt.

This is **structurally what Anthropic's Skills API does**: skill files exist as git/filesystem on the developer side, get uploaded to a workspace-scoped registry via `/v1/skills`, then materialized into the VM filesystem at runtime when `container.skills` references them. Cogni replicates the pattern with dolt as the registry.

> **What the dolt sync buys us, concretely** — (1) cross-node skill discovery in one query, (2) one MCP URL serves all skills, (3) skills get domains/tags/confidence/citations from day one, (4) agent-authored skill drafts via the existing contribution flow (with human review → merge to git → next sync goes live), (5) future vector search over skills + knowledge unified, (6) external agents don't need filesystem access to Cogni's repo to use our skills.

### Finding 3 — Co-location is a Claude-Code-native pattern, supported today

Claude Code's filesystem walker descends into subdirectories — `nodes/poly/.claude/skills/poly-market-data/SKILL.md` auto-loads when editing under `nodes/poly/`. Cursor uses proximity-resolved `.cursor/rules/*.mdc` similarly. No invention needed; we just have to *use* this. The right convention:

```
.claude/skills/                       # cross-cutting (lifecycle + universal)
  research/, commit/, validate-candidate/, contribute-to-cogni/, ...
nodes/operator/.claude/skills/        # operator-only expertise
  deploy-operator/, constraint-evaluator/, ...
nodes/poly/.claude/skills/            # poly-only expertise
  poly-market-data/, poly-copy-trading/, delta-minimizer/, ...
```

Of the 29 skills in `.claude/skills/` today, ~15 belong under a node (`poly-*`, `delta-minimizer`, `deploy-operator`, `deploy-node`, `constraint-evaluator`, `engineering-optimizer`, `landing-page`, `node-setup`, `dolt-human-visuals`). The remaining ~14 are genuinely cross-cutting (`contribute-to-cogni`, `validate-candidate`, `promote`, `schema-update`, `test-expert`, `devops-expert`, `git-app-expert`, `database-expert`, `dns-ops`, `grafana-dashboards`, `monitoring-expert`, `ui-ux-pro-max`, `third-party-integrator`, `data-research`). The 37 OpenClaw skills are all lifecycle commands → stay cross-cutting under `.claude/skills/`.

The `.claude/`-baked-into-3-touchpoints constraint matters: don't rename to `.cogni/skills/`. Keep `.claude/skills/` as the directory name at every depth (root + node-level). One convention, multiple roots.

### Finding 4 — One frontmatter schema accommodates both categories

Today `.claude/skills/` uses `name`/`description`; `.openclaw/skills/` adds `user-invocable: true`. Unify on Anthropic's spec + optional Cogni extensions:

```yaml
---
name: research                       # required (Anthropic)
description: Use when …              # required (Anthropic)
user_invocable: true                 # optional Cogni extension — exposes as MCP Prompt + /command
node: operator                       # optional Cogni extension — set by sync if path-inferred
scope: cross-cutting | node | package # optional Cogni extension
---
```

`user_invocable: true` → registered as MCP **Prompt** (slash-callable). All skills → searchable via MCP **Tools** (`list_skills`, `get_skill`, `search_skills`). `node` is path-inferred during dolt sync — no need to set it by hand.

### Finding 5 — One MCP URL + existing bearer auth is the right v0 surface

Single config line for any external agent (Claude Code, OpenClaw, Codex, Cursor, future):

```json
{ "mcpServers": { "cogni": {
    "url": "https://cognidao.org/mcp",
    "headers": { "Authorization": "Bearer ${COGNI_API_KEY}" }
}}}
```

Tools exposed:

- `search_skills(query, node?, user_invocable?)` — semantic+lexical search over skill descriptions
- `list_skills(node?, scope?)` — frontmatter only (L1 progressive disclosure, ~tens of tokens per skill)
- `get_skill(name)` — body + asset paths (L2; L3 files retrievable via separate tool or HTTP)
- `search_knowledge(query, domain?, entry_type?, node?)` — wraps `KnowledgeStorePort`; can include `entry_type: skill`
- `read_knowledge(id)`
- Each `user_invocable: true` skill additionally registered as an MCP **Prompt** so `/research`, `/commit`, etc. work in clients that support MCP Prompts

Auth = existing `cogni_ag_sk_v1_*` bearer. Same audit trail, same per-principal logging. Plan CIMD migration when the MCP client ecosystem catches up; the bearer-only deployment isn't a dead end (Smithery, Composio, Cloudflare AutoRAG all support bearer-in-header alongside their OAuth proxy options).

OAuth 2.1 + PKCE + CIMD becomes mandatory for *public* remote servers per the late-2025 spec direction; ours is *bearer-protected per-tenant*, which the spec accommodates today via `Authorization` header. If we ever go public-multi-tenant, that's the migration trigger.

## Recommendation

**Adopt the Anthropic pattern (git authored, registry stored, runtime rendered), with dolt as the registry and `.claude/skills/` co-located under nodes.**

Concretely:

1. **Adopt one skill format.** Anthropic SKILL.md frontmatter + two optional Cogni fields (`user_invocable`, `node` path-inferred).
2. **Co-locate under `.claude/skills/` at multiple depths.** Cross-cutting at `./.claude/skills/`, node-scoped at `nodes/<node>/.claude/skills/`. Keep the directory name `.claude/skills/` everywhere to avoid touching the three hardcoded references. Claude Code natively discovers nested roots.
3. **One canonical tree, two harness configs.**
   - `.openclaw/skills/` content collapses into `.claude/skills/` (preserving `user_invocable: true` for lifecycle commands). `.openclaw/skills/` becomes either a symlink to `.claude/skills/` or, cleaner, OpenClaw's `extraDirs` config (`services/sandbox-openclaw/openclaw-gateway.json:268`) gets updated to point at all `.claude/skills/` roots: `["/repo/current/.claude/skills", "/repo/current/nodes/operator/.claude/skills", "/repo/current/nodes/poly/.claude/skills", ...]`. Glob support in `extraDirs` would be even cleaner — worth a small OpenClaw PR.
   - `.agents/skills/skill-creator` collapses to `.claude/skills/skill-creator` (it's already symlinked the other way; just flip the symlink direction).
4. **Sync skills to dolt as `entry_type: skill` rows.** CI step on merge to main (and on candidate-a deploy) walks `**/.claude/skills/*/SKILL.md`, upserts to `knowledge` table. `source_node` inferred from path. `source_ref` = repo path. Body in `content`. Frontmatter into `tags` JSONB. Idempotent by `source_ref`.
5. **Build operator MCP server at `https://cognidao.org/mcp`.** Next.js route handler in `nodes/operator/app/src/app/mcp/route.ts` using `@modelcontextprotocol/sdk` + `mcp-handler` (Vercel adapter, fits Next App Router). Tools enumerated in Finding 5. Auth reuses `cogni_ag_sk_v1_*` bearer.
6. **Filesystem stays the local-dev fast path.** Claude Code on a laptop reads `.claude/skills/` directly — no MCP round-trip needed. Remote agents (Codex, Cursor, sandbox OpenClaw, hosted agents) connect via MCP URL. Same SKILL.md content either way.
7. **Agent-authored skills via existing contribution flow.** `POST /api/v1/knowledge/contributions { entry_type: "skill", ... }` → branched contribution → human reviews + merges → CI sync re-runs → live. Reuses existing infra (branched dolt + provenance + principal_id). Authoring path for *humans* stays git+PR.

### Why this addresses the v1 pushback explicitly

- **"What's the point of dolt"** → dolt is the indexed, queryable, MCP-served substrate. Skills get domains, tags, confidence, citations, source_node filtering, cross-node search, contribution flow, principal_id audit for free. Filesystem-only would be a thin git proxy — *that* would have no point.
- **"You positive these should live in git"** → authored in git (PR review, blame, history are non-negotiable for code-adjacent docs), served from dolt (the runtime substrate every external agent talks to). Both. Like Anthropic's own Skills API.
- **"Not just `.claude/skills/` at root"** → co-located under `nodes/<node>/.claude/skills/`, supported natively by Claude Code's subdir walker, expanded in OpenClaw via `extraDirs`. ~15 of the 29 root skills move under a node.
- **"Clean up duplication"** → the real duplication is small (`ui-ux-pro-max` only). The bigger work is the three trees collapsing to one canonical (`.claude/skills/` everywhere) with OpenClaw reconfigured rather than maintaining its own tree.
- **"Reference companies"** → Anthropic Skills API (registry + VM filesystem), PromptLayer Skill Collections (DB + SDK pull), skillsmp.com (catalog + MCP), Continue Hub (registry), mcp.run (Wasm registry), Mintlify/Inkeep/Cloudflare AutoRAG (docs-as-MCP UX). Recommendation lines up with what the platforms — not the aggregators — actually ship.

### Trade-offs accepted

- Dual-write/sync (git → dolt) adds a CI step and a small data invariant ("dolt skill rows are downstream of git, not the source of truth for authoring"). Worth it for the unified read surface.
- Co-location reshuffles ~15 skill paths. Touches the 3 hardcoded `.claude/skills/`-prefix references → all 3 can stay as-is (cross-cutting skills don't move; only node-scoped ones do, and the affected references all point at cross-cutting skills like `validate-candidate`).
- OpenClaw needs `extraDirs` updated (or a glob feature added) — small config or small upstream PR.
- Per-node MCP endpoints deferred to v1. Operator-central with `node` parameter is good enough until per-node sovereignty becomes a real constraint.
- Skill versioning (Anthropic Skills API takes `version`) deferred. Git SHA can serve as implicit version on the sync row.

## Open Questions

- **Sync timing**: on every merge to main (cheap, frequent) vs. on candidate-a deploy (coarser, matches deploy cadence)? Probably both — merge-time updates "main" rows, candidate-a deploy promotes them.
- **Authoring-via-contribution UX**: how does a human-authored skill PR vs. an agent-authored knowledge_contribution-with-entry_type=skill interact? They write to the same target row keyed by `source_ref`. We probably want agent contributions to *propose a draft SKILL.md as a PR*, not write directly to dolt — the dolt write becomes the post-merge sync. (This keeps git as the canonical authoring path for both humans and agents.)
- **MCP transport**: streamable-HTTP (correct for our remote use case) — confirm `@modelcontextprotocol/sdk` HTTP transport stability with late-2025 clients. Most current clients still want stdio + `mcp-remote` shim; pin the patched version (CVSS 9.6 RCE fixed in 2025).
- **`.claude/skills/` rename risk**: zero — we don't rename, we just add depth. Existing `agent.json:70` / `ci.yaml:86,139` references continue to work.
- **OpenClaw `extraDirs` glob**: does the upstream OpenClaw codebase support globs in `extraDirs`? If not, a small upstream PR vs. listing each node's path explicitly. Listing is fine until we have many nodes.
- **Skill index storage**: in-memory at MCP server boot (rebuild from dolt query) vs. dolt-indexed (Postgres FTS / pgvector)? Start with in-memory + dolt query; add FTS/pgvector when search quality demands it.
- **Frontmatter migration**: `.openclaw/skills/*` use `user-invocable: true`. New convention is `user_invocable: true` (snake_case to match the rest of our schemas). One-shot rename script.
- **Cross-surface drift**: Anthropic's own warning ("claude.ai / API / Claude Code do NOT sync") is a sharper version of our problem. Our solution = single substrate (dolt) means every surface reads the same data — the failure mode Anthropic warns about doesn't apply.
- **`.well-known/agent.json` advertises `mcpUrl`**: yes, natural fit. Should it advertise a *list* of MCP URLs (operator-central + per-node)? Defer until per-node MCP exists.
- **Public-vs-private MCP**: today the MCP server is bearer-protected and effectively per-tenant. If we want a *public* read-only MCP surface (skills are open-source, knowledge is public for certain nodes), that's a separate endpoint and triggers CIMD migration.

## Proposed Layout

> Directional. Captured as prose, not pre-decomposed work items (per project memory on no preemptive decomposition).

### Project

`proj.*` — call it **"Cogni MCP Surface + skill consolidation v0"**. Phases:

1. **Phase 0 — Spec + classification.** One spec under `docs/spec/mcp-surface.md` covering: tree convention (`.claude/skills/` at multiple depths), frontmatter contract (Anthropic + Cogni extensions), sync invariants, MCP tool list + schemas, auth, progressive disclosure. Plus a classification pass on the existing 29 + 37 skills → which stay cross-cutting vs. move under `nodes/<node>/`.

2. **Phase 1 — Skill tree consolidation (no MCP yet).** Move ~15 node-scoped skills from `.claude/skills/` to `nodes/<node>/.claude/skills/`. Add `extraDirs` entries to OpenClaw config for each new root. Resolve the `ui-ux-pro-max` duplicate (symlink). Flip `.agents/skills/skill-creator` symlink direction. Frontmatter normalize (`user-invocable` → `user_invocable`). Verify Claude Code + OpenClaw both still discover everything. This phase alone delivers value (cleaner repo, co-located skills) without touching MCP or dolt.

3. **Phase 2 — Dolt sync.** Add `entry_type: skill` as a recognized value in the knowledge schema (free-text column, so this is a documentation + sync update, not a migration). Build a CI step / deploy hook that walks `**/.claude/skills/*/SKILL.md`, upserts to `knowledge` keyed by `source_ref`. Idempotent. Run on merge-to-main + candidate-a deploy. Verify rows appear in operator's dolt with correct `source_node`.

4. **Phase 3 — Operator MCP server v0 (knowledge tools only).** Next.js route at `nodes/operator/app/src/app/mcp/route.ts`. `search_knowledge` + `read_knowledge` tools. Bearer auth. Smoke-test with a real `cogni_ag_sk_v1_*` from `mcp-remote`. Validates the auth + transport before adding the skill loader.

5. **Phase 4 — Skill tools + Prompts.** `list_skills`, `get_skill`, `search_skills` reading from dolt (synced in Phase 2). Each `user_invocable: true` skill registered as MCP Prompt. Now a single config line gives any external agent the full skill surface.

6. **Phase 5 — Discovery + onboarding.** `.well-known/agent.json` advertises `mcpUrl`. `/contribute-to-cogni` skill updated to instruct: "first onboarding step = add this MCP URL to your client config." Deprecate the older filesystem-instructions in favor of the MCP path for non-Claude-Code harnesses.

7. **Phase 6 (deferred) — Search quality + vector.** Postgres FTS on `knowledge.content` + `knowledge.title`. pgvector after.

8. **Phase 7 (deferred) — Agent-authored skill drafts via contribution flow.** Wire `POST /knowledge/contributions { entry_type: "skill" }` to produce a PR (or human-reviewable draft) rather than writing directly to dolt. Only build when there's a real use case.

### Specs needed

- **New**: `docs/spec/mcp-surface.md` — MCP contract (tools, auth, scoping, progressive disclosure invariants, tree convention, sync invariants).
- **New**: `docs/spec/skill-format.md` — Anthropic SKILL.md + Cogni extensions (`user_invocable`, `node`, sync rules). Or fold into the above.
- **Updated**: `docs/spec/architecture.md` — MCP as a first-class boundary alongside REST.
- **Updated**: `nodes/operator/app/src/app/.well-known/agent.json/route.ts` — add `mcpUrl` field.
- **Cite from**: `docs/research/mcp-production-deployment-patterns.md` (auth direction already settled).

### Likely PR-sized tasks (rough sequence, not yet filed)

1. Spec the MCP surface + skill format + tree convention (Phase 0). One PR, one or two specs.
2. Classify the 29 + 37 skills + move node-scoped ones; update OpenClaw `extraDirs`; resolve `ui-ux-pro-max` dup; flip `.agents/skill-creator` symlink (Phase 1).
3. Dolt sync job + `entry_type: skill` documentation (Phase 2).
4. Operator MCP route + `search_knowledge` + `read_knowledge` + bearer (Phase 3).
5. `list_skills` / `get_skill` / `search_skills` + Prompt registration (Phase 4).
6. `.well-known/agent.json` advertises `mcpUrl`; `/contribute-to-cogni` onboarding rewrite (Phase 5).

Tasks 1–5 are critical-path to a working 1-URL UX. Task 2 is the highest-leverage standalone improvement (cleaner repo) — could ship before Phase 2/3 if MCP is delayed.

### How this fits the existing architecture

- **Hexagonal layering preserved.** MCP server is a new inbound port alongside REST. Tools call existing `KnowledgeStorePort` adapters. Skill sync is a new outbound job (filesystem → KnowledgeStorePort write).
- **No new auth substrate.** Reuses `cogni_ag_sk_v1_*` bearer — same principal_id, same audit trail.
- **Knowledge hub becomes the canonical read substrate for skills + knowledge unified.** Filesystem stays canonical for *authoring*; dolt is canonical for *serving*. Sync is downstream-only (one-way: git → dolt).
- **Skills become first-class knowledge entries.** Inherit domains, citations, tags, confidence, source_node, contribution-flow. Future cross-node skill discovery is one SQL query.
- **Per-node sovereignty respected** via the `source_node` column and the `node` query parameter. Per-node MCP endpoints remain a v1 option without breaking v0 clients.
- **Co-location respects how Claude Code already works** — subdir-aware skill discovery — and brings OpenClaw into alignment via its existing `extraDirs` mechanism.
