---
id: spike.0229
type: spike
title: "Knowledge Aggregation — KnowledgeCapability Port"
status: needs_design
priority: 1
rank: 1
estimate: 3
summary: Add KnowledgeCapability port (same hexagonal pattern as RepoCapability) so agents can search, read, and write research findings. Phase 1 adapter scans docs/research/ markdown frontmatter. Brain graph gets knowledge tools alongside repo tools.
outcome: Brain agents can search existing research before hitting the internet, and save new findings that future agents find automatically.
spec_refs:
assignees: derekg1729
credit:
project: proj.oss-research-node
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-29
updated: 2026-03-29
labels: [knowledge-base, agents, research, infrastructure, niche-node]
external_refs:
---

# Knowledge Aggregation — KnowledgeCapability Port

Parent: `proj.oss-research-node` | Related: `spike.0137`

## Problem

Agents produce research that evaporates. The same questions get re-researched. 38 research docs already exist in `docs/research/` with structured YAML frontmatter — but no agent can search them, and no agent saves findings there.

The brain can search **code** via `RepoCapability`. It cannot search **knowledge**.

## Design

### Outcome

Agents search existing research findings before hitting the internet. When they research something new, they save it. Knowledge compounds monotonically.

### Approach

**Solution**: New `KnowledgeCapability` port following the exact hexagonal pattern as `RepoCapability` and `WorkItemQueryPort`.

**Reuses**:

- Same capability → tool → adapter pattern as `RepoCapability` (`packages/ai-tools/`)
- Same YAML frontmatter parsing approach as `MarkdownWorkItemAdapter` (`packages/work-items/`)
- Same DI wiring pattern (`bootstrap/capabilities/` → `tool-bindings.ts` → container)
- Brain graph already exists — just add knowledge tool IDs to its tool list

**Rejected**:

- Separate knowledge service/microservice — premature, no scale need yet
- pgvector-first — need chunks before we need embeddings. Markdown adapter is the right Phase 1
- Custom search infrastructure — ripgrep on `docs/research/` + frontmatter parsing covers Phase 1
- Separate "knowledge-chunks" subdirectory — `docs/research/` already IS the knowledge base

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ packages/ai-tools/src/capabilities/knowledge.ts     │  ← PORT (interface only)
│   KnowledgeCapability { search, read, write }       │
├─────────────────────────────────────────────────────┤
│ packages/ai-tools/src/tools/                        │  ← TOOLS (use capability)
│   core__knowledge_search                            │
│   core__knowledge_read                              │
│   core__knowledge_write                             │
├─────────────────────────────────────────────────────┤
│ apps/operator/src/adapters/server/knowledge/             │  ← PHASE 1 ADAPTER
│   markdown-knowledge.adapter.ts                     │
│   Scans docs/research/*.md, parses frontmatter      │
│   Keyword match on summary + tags + title + body    │
│   Write = create/update markdown file               │
├─────────────────────────────────────────────────────┤
│ apps/operator/src/adapters/server/knowledge/             │  ← PHASE 2 ADAPTER (later)
│   postgres-knowledge.adapter.ts                     │
│   pgvector embeddings, SQL filters                  │
│   Markdown files remain source of truth             │
├─────────────────────────────────────────────────────┤
│ packages/langgraph-graphs/src/graphs/brain/         │  ← BRAIN GETS KNOWLEDGE
│   tools.ts: add KNOWLEDGE_SEARCH, _READ, _WRITE    │
│   prompts.ts: "search knowledge before answering"   │
└─────────────────────────────────────────────────────┘
```

### KnowledgeCapability Interface (draft)

```typescript
interface KnowledgeChunk {
  id: string; // e.g. "research-crypto-domain-purchasing"
  title: string;
  summary: string; // THE key search field
  tags: string[];
  trust: "draft" | "verified";
  status: "active" | "stale" | "superseded";
  readWhen: string; // natural language trigger
  created: string; // ISO date
  verified: string; // last verification date
  owner: string;
  body: string; // full markdown content
  path: string; // file path for citation
}

interface KnowledgeSearchParams {
  query: string; // keyword search across summary + tags + title + body
  tags?: string[]; // filter by tags (AND)
  trust?: "draft" | "verified";
  status?: "active"; // default: only active
  limit?: number; // max 20
}

interface KnowledgeCapability {
  search(params: KnowledgeSearchParams): Promise<{ chunks: KnowledgeChunk[] }>;
  read(id: string): Promise<KnowledgeChunk | null>;
  write(
    chunk: Partial<KnowledgeChunk> & {
      title: string;
      summary: string;
      tags: string[];
      body: string;
    }
  ): Promise<KnowledgeChunk>;
}
```

### Knowledge Chunk Frontmatter (existing — already works)

The 38 docs in `docs/research/` already use this:

```yaml
---
id: research-{slug}
type: research
title: "..."
status: active # active | stale | superseded
trust: draft # draft | verified
summary: "..." # keyword-rich, 1-2 sentences
read_when: "..." # when an agent should read this
owner: derekg1729
created: 2026-03-28
verified: 2026-03-28
tags: [knowledge-chunk, domains, x402]
---
```

No new schema needed. The existing frontmatter IS the schema.

### Chunk Body Formats

Not all knowledge is prose. Agents should produce — and `core__knowledge_write` should accept — structured body formats:

| Format                | When to use                         | Example                                          |
| --------------------- | ----------------------------------- | ------------------------------------------------ |
| **Scorecard**         | Gap analysis, maturity assessment   | `\| Dimension \| Us \| Top 0.1% \| Gap \|`       |
| **Ranked options**    | Technology/vendor selection         | `\| Option \| Pros \| Cons \| Recommendation \|` |
| **Priority actions**  | Actionable next steps from research | `\| Pri \| Action \| Why \|`                     |
| **Decision record**   | Architecture/technology choice made | Context → Options → Decision → Consequences      |
| **Comparison matrix** | Feature/capability comparison       | `\| Feature \| Tool A \| Tool B \| Tool C \|`    |

The body is markdown — these are just table patterns agents should default to. Prose is the fallback, not the default. Structured findings are scannable, comparable, and queryable.

### Confidence Growth Over Time

- `trust: draft` → agent-produced, unverified
- `trust: verified` → human-reviewed OR agent re-confirmed with fresh sources
- `verified: date` → last check. Agent compares against current date
- `status: stale` → past freshness window, needs re-research
- `status: superseded` → replaced by newer chunk (old chunk links to new via body text)
- No scores, no floats, no ML — just `draft`/`verified` and dates. Simple.

### The Recall Loop (agent behavior, not infrastructure)

```
Agent gets question
  → core__knowledge_search(query, tags)
  → Found & verified & recent? → Use it, cite the file path
  → Found but stale? → Re-research via core__web_search, update chunk via core__knowledge_write
  → Not found? → core__web_search, then core__knowledge_write to save findings
```

This is enforced in the **brain system prompt**, not in code. Same pattern as citation enforcement.

### Invariants

- [ ] KNOWLEDGE_READ_WRITE: Unlike repo (read-only), knowledge capability allows writes (agents save findings)
- [ ] FRONTMATTER_IS_SCHEMA: No separate schema definition — YAML frontmatter in `docs/research/*.md` is the contract
- [ ] SEARCH_BEFORE_FETCH: Brain prompt instructs agents to search knowledge before web search
- [ ] TRUST_NEVER_AUTO_PROMOTED: Agents can create `trust: draft`. Only humans set `trust: verified`
- [ ] EXISTING_PATTERN: Follows exact RepoCapability → tool → adapter → bootstrap → container pattern
- [ ] ARCHITECTURE_ALIGNMENT: Port in `packages/ai-tools`, adapter in `apps/operator/src/adapters/server/`

### Files

- Create: `packages/ai-tools/src/capabilities/knowledge.ts` — KnowledgeCapability interface
- Create: `packages/ai-tools/src/tools/knowledge-search.ts` — core\_\_knowledge_search tool
- Create: `packages/ai-tools/src/tools/knowledge-read.ts` — core\_\_knowledge_read tool
- Create: `packages/ai-tools/src/tools/knowledge-write.ts` — core\_\_knowledge_write tool
- Modify: `packages/ai-tools/src/catalog.ts` — add knowledge tools to TOOL_CATALOG
- Create: `apps/operator/src/adapters/server/knowledge/markdown-knowledge.adapter.ts` — Phase 1 adapter
- Create: `apps/operator/src/adapters/test/knowledge/fake-knowledge.adapter.ts` — test double
- Create: `apps/operator/src/bootstrap/capabilities/knowledge.ts` — capability factory
- Modify: `apps/operator/src/bootstrap/ai/tool-bindings.ts` — wire knowledge tools
- Modify: `apps/operator/src/bootstrap/container.ts` — add knowledgeCapability
- Modify: `packages/langgraph-graphs/src/graphs/brain/tools.ts` — add knowledge tool IDs
- Modify: `packages/langgraph-graphs/src/graphs/brain/prompts.ts` — "search knowledge first"
- Test: `packages/ai-tools/tests/tools/knowledge-search.test.ts` — tool contract tests
- Test: `apps/operator/src/adapters/server/knowledge/markdown-knowledge.adapter.test.ts` — adapter tests

### Phase 2: Postgres + pgvector (when grep stops working)

Same port, swap adapter. Markdown files stay as source of truth:

- On `write()`: save markdown file AND upsert into Postgres with embedding
- On `search()`: pgvector similarity search instead of grep
- Migration trigger: when keyword search misses obvious matches (semantic gap)

### Phase 3: Cross-Node Federation (when multiple nodes exist)

- Expose `KnowledgeCapability.search` via x402-gated HTTP endpoint
- Agent on Node B calls Node A's endpoint, pays per query
- Trust is per-node: Node B decides whether to trust Node A's `verified` status
- This is just an HTTP adapter behind the same port

## Plan

- [x] First knowledge chunk exists (`docs/research/crypto-domain-purchasing-landscape.md`)
- [x] Data stack progression defined (memory: `project_node_data_progression.md`)
- [ ] Design review (this document)
- [ ] Decompose into tasks: port → tools → adapter → brain wiring → tests

## Validation

- Brain agent finds existing research chunk instead of re-researching
- Brain agent saves new research that a subsequent brain session finds
- No new infrastructure — markdown files + existing hexagonal pattern only

## PR / Links

- Related: `spike.0137`, `proj.oss-research-node`
- Pattern source: `RepoCapability` (`packages/ai-tools/src/capabilities/repo.ts`)
- Pattern source: `MarkdownWorkItemAdapter` (`packages/work-items/src/adapters/markdown/`)
- First chunk: `docs/research/crypto-domain-purchasing-landscape.md`

## Attribution

-
