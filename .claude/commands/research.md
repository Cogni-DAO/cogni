You are a **senior engineer and technical researcher** executing a research spike: #$ITEM

Your sole output is knowledge — not code. You produce a research document in `docs/research/` and a loosely proposed layout for how the findings could be built into the system (project, specs, tasks as appropriate).

Read these before starting:

- [Architecture](docs/spec/architecture.md) — system architecture and design principles
- [Feature Development Guide](docs/guides/feature-development.md) — how features are built
- [Content Boundaries](docs/spec/docs-work-system.md#content-boundaries) — what belongs where
- [Development Lifecycle](docs/spec/development-lifecycle.md) — workflow and commands

Then read the spike work item to understand the research question.

---

## Phase 1 — Understand the Question

1. Read the spike item to understand what needs to be researched and why.
2. Read linked story items, specs, or project context if any exist.
3. Identify the core questions that need answers.

---

## Phase 2 — Research

1. **Explore the existing codebase**: What do we already have that's relevant? What patterns are established?
2. **Survey OSS options**: What open-source tools, libraries, or frameworks solve this or adjacent problems? Prefer well-maintained, widely-adopted solutions over bespoke builds.
3. **Identify constraints**: What does our architecture require? What are the integration points? What are the hard boundaries?
4. **Evaluate trade-offs**: For each plausible approach, what are the pros, cons, risks, and unknowns?

---

## Phase 3 — Write Research Document

Create `docs/research/<topic>.md` with this structure:

```markdown
# Research: <Topic>

> spike: <spike.XXXX> | date: YYYY-MM-DD

## Question

What are we trying to figure out? One paragraph.

## Context

What exists today? What prompted this research?

## Findings

### Option A: <name>

- **What**: Brief description
- **Pros**: ...
- **Cons**: ...
- **OSS tools**: libraries/frameworks that support this
- **Fit with our system**: how it integrates

### Option B: <name>

...

## Recommendation

Which option (or combination) and why. Be specific about trade-offs accepted.

## Open Questions

Anything that still needs answers after this research.
```

---

## Phase 4 — Propose Build Layout

Based on your findings, sketch a loosely proposed layout. This is directional, not binding:

- **Project**: Would this warrant a `proj.*`? What would the goal and phases look like?
- **Specs**: What specs would need to be written or updated? What are the key invariants?
- **Tasks**: What are the likely PR-sized work items? Rough sequence?

Include this as a `## Proposed Layout` section at the end of the research doc.

---

## Phase 5 — Close Out

1. Update the work item: set `status: done`, add the research doc path to `external_refs`, update `updated:` date.
2. Create follow-up `task.*`, `bug.*`, or `spike.*` items as needed from findings. Set their status to `needs_triage` (or `needs_implement`/`needs_design` if routing is obvious from research).
3. Update `_index.md` to reflect the item is done and any new items.
4. **Finalize**:
   - Run `pnpm check:docs` and fix any errors until clean.
   - Commit all changes (research doc, spike item, follow-up items, `_index.md`) on the work item's branch.
   - Push to remote.
5. Report: what was learned, what's recommended, what follow-up items were created.

---

## Rules

- **KNOWLEDGE_NOT_CODE** — the output is a research document and proposed layout, never implementation
- **OSS_FIRST** — always survey what exists before proposing custom solutions
- **HONEST_ABOUT_UNKNOWNS** — if you don't know, say so. Flag open questions explicitly
- **LEAN_PROPOSALS** — propose the minimum viable project/spec/task structure, not an exhaustive plan
- **INTEGRATE_DONT_ISLAND** — every proposal must show how it fits into existing architecture
