---
id: task.0260
type: task
title: "Node creation orchestration — chat-native guided flow"
status: needs_implement
priority: 1
rank: 2
estimate: 8
summary: "Unified chat experience for creating a new Cogni node. Operator AI guides human through intake, identity, DAO formation (inline wallet signing via display-only tool + makeAssistantToolUI), scaffolding, branding, PR, and DNS — all in one thread. P0 uses multi-turn tool renderers; P1 migrates to formal HIL interrupt/resume."
outcome: "User says 'create a new node' in chat → AI walks them through identity → inline DAO formation with wallet signing → autonomous scaffolding + branding → PR created → DNS configured. Zero page navigation."
spec_refs:
  - docs/spec/node-formation.md
  - docs/spec/human-in-the-loop.md
  - docs/spec/multi-node-tenancy.md
assignees:
credit:
project: proj.node-formation-ui
branch:
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [ai, ui, nodes, formation]
external_refs:
---

# Node Creation Orchestration — Chat-Native Guided Flow

## Context

Creating a new Cogni node today is fragmented: fill a form on `/setup/dao`, copy YAML to clipboard, manually edit files, run scripts, create a PR, set up DNS. The legacy wizard page is a dead-end — it outputs YAML, shows "Done", and stops.

The vision: a **single chat thread** where the operator AI guides the human through every step. The AI pre-fills, suggests, and executes. The human confirms, signs wallet transactions inline, and reviews.

## Design

### Outcome

User says "create a new node" in operator chat → AI guides through intake/identity → inline DAO formation with wallet signing (no page navigation) → AI autonomously scaffolds, brands, creates PR, configures DNS → node is live in local dev.

### Critical Design Decision: Display-Only Tools, Not HIL

The HIL interrupt/resume spec (`docs/spec/human-in-the-loop.md`) is **entirely unimplemented** — no interrupt event type, no resumeValue in the chat contract, no pause detection in the InProc runner. Building full HIL requires refactoring the runner from `graph.invoke()` to `graph.stream()` with checkpoint persistence — a multi-day platform effort.

Instead, P0 uses **display-only tools with `makeAssistantToolUI`** from assistant-ui:

1. Graph calls a tool (e.g., `request_dao_formation`) with pre-filled params
2. Server-side tool handler returns a static result: `{ status: "awaiting_user_action" }`
3. Client-side: `makeAssistantToolUI` renders `DAOFormationCard` instead of `ToolFallback`
4. Card runs wallet signing client-side using the existing `useDAOFormation` hook
5. On success, card shows "Continue" button → user sends structured message with result
6. AI processes result in next turn, continues with scaffolding

This is functionally equivalent to HIL but simulated via multi-turn chat. It gets 80% of the UX for 20% of the infrastructure cost.

**Rejected: Full HIL interrupt/resume (Option B)**
Requires refactoring InProc runner, new AiEvent type, new contract fields, `execution_state_handles` DB table, atomic lock — all for one use case. Build this when multiple features need it.

**Rejected: Message markers / prompt-based rendering (Option A raw)**
Fragile (AI must produce exact marker format), prompt injection risk, thread replay breaks. Tool calls are structured and typed — much safer.

**Rejected: "Go to wizard page and paste YAML" (Option D)**
This is the current Claude Code skill approach. Works for developers, not for founders in a chat UI. The whole point is eliminating this friction.

### Approach

**Solution:** Display-only tools + `makeAssistantToolUI` for interactive cards, multi-turn chat for state continuity, existing VCS/repo tools for autonomous scaffolding.

**Reuses:**
- `formation.reducer.ts` — 9-phase FSM (zero changes)
- `txBuilders.ts` — transaction argument builders (zero changes)
- `useDAOFormation.ts` — wagmi hook integration (zero changes)
- `/api/setup/verify` — server verification endpoint (zero changes)
- VCS tools — `vcs_create_branch`, `vcs_list_prs` (existing)
- Repo tools — `repo_list`, `repo_open`, `repo_search` (existing)
- `makeAssistantToolUI` — assistant-ui documented pattern (first use)

### The Experience

```
User: "I want to create a new node for restaurant reservations"

AI: [conversational intake — asks about mission, community, AI needs]
AI: "Here's what I'd suggest:"
    → Calls tool: propose_node_identity({ name, icon, hue, mission, tokenName, tokenSymbol })
    [renders: IdentityProposalCard — editable fields, confirm button]
    ⚠ Token name + symbol can be changed later via governance.
      All other fields are immutable after formation.

User: [confirms via "Continue" button → sends structured message]

AI: "Let's create the DAO. Connect your wallet and sign."
    → Calls tool: request_dao_formation({ tokenName, tokenSymbol })
    [renders: DAOFormationCard — pre-filled, inline wallet signing]

User: [signs 2 transactions, card shows progress inline]
      [clicks "Continue" → sends repoSpecYaml + addresses as message]

AI: "DAO created. Building the node now..."
    → [autonomous via existing tools: branch, copy template, rename, wire env]
    → [autonomous: apply branding, create graph, provision DB]
    → Calls tool: present_pr({ url, diffStats, summary })
    "PR ready for review."
    [renders: PRReviewCard — diff summary, link]

User: [reviews externally, sends approval message]

AI: → [autonomous: DNS creation via dns-ops]
    → Calls tool: present_node_summary({ name, port, prUrl, dnsStatus })
    [renders: NodeSummaryCard — final status]
```

### Architecture

```
┌──────────────────────────────────────────────┐
│  node-creator graph (LangGraph ReAct)        │
│  System prompt: node creation lifecycle      │
│  Tools: display-only + existing VCS/repo     │
├──────────────────────────────────────────────┤
│  Turn 1-N: Intake + Identity (conversational)│
│    → propose_node_identity tool call         │
│  Turn N+1: User confirms identity            │
│    → request_dao_formation tool call         │
│  Turn N+2: User sends formation result       │
│    → autonomous scaffolding (VCS + repo)     │
│    → present_pr tool call                    │
│  Turn N+3: User approves PR                  │
│    → autonomous DNS (dns-ops)                │
│    → present_node_summary tool call          │
└──────────────────────────────────────────────┘
        ↕ stateKey (thread replay persistence)
┌──────────────────────────────────────────────┐
│  Chat UI (assistant-ui)                      │
│  makeAssistantToolUI renderers:              │
│   • IdentityProposalCard                     │
│   • DAOFormationCard (uses useDAOFormation)   │
│   • PRReviewCard                             │
│   • NodeSummaryCard                          │
└──────────────────────────────────────────────┘
```

### Display-Only Tools (4 new)

| Tool | Args (AI provides) | Server result | Client renders |
|------|-------------------|---------------|----------------|
| `propose_node_identity` | `{ name, icon, hue, mission, tokenName, tokenSymbol }` | `{ status: "awaiting_confirmation" }` | IdentityProposalCard |
| `request_dao_formation` | `{ tokenName, tokenSymbol }` | `{ status: "awaiting_wallet_action" }` | DAOFormationCard |
| `present_pr` | `{ url, diffStats, summary }` | `{ status: "awaiting_review" }` | PRReviewCard |
| `present_node_summary` | `{ name, port, prUrl, dnsRecord }` | `{ status: "complete" }` | NodeSummaryCard |

These tools have **no server-side I/O** — they exist solely to create structured tool-call events that the client renders as rich cards. The tool handler is a pure function returning the static status.

### Thread Replay Safety

On thread replay (page reload), tool renderers must handle stale state:
- Check if a subsequent user message contains the expected result
- If yes: render a static "completed" summary card (not the interactive flow)
- If no: render the interactive card (user hasn't completed this step yet)

### Identity Proposal — Mutability Note

All fields become immutable after DAO formation **except**:
- `tokenName` — changeable via governance proposal (on-chain metadata)
- `tokenSymbol` — changeable via governance proposal (on-chain metadata)

Node name, icon, hue, and mission are baked into code/branding at scaffolding time. The IdentityProposalCard must clearly communicate this.

### Governance Templates (v2)

| Template | Supply | Allocation | Voting | Best For |
|----------|--------|------------|--------|----------|
| Standard DAO | 1M | 100% founder | Simple majority, 1h min | Solo, MVPs |
| Multi-Holder | 1M | 50/30/20 split | Weighted, 3-day timelock | Teams |

Data-driven config rendered by IdentityProposalCard. Not in P0.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] FORMATION_LOGIC_UNCHANGED: `formation.reducer.ts`, `txBuilders.ts`, `useDAOFormation.ts`, `api.ts` have zero modifications
- [ ] TOOL_CATALOG_IS_CANONICAL: Display-only tools registered in catalog with toolIds, resolved at runtime
- [ ] NO_SIDE_EFFECTS_BEFORE_APPROVAL: DAO formation (wallet signing) only happens after user explicitly clicks sign in the card
- [ ] PACKAGES_NO_SRC_IMPORTS: Tool contracts in `@cogni/ai-tools`, not in `src/`
- [ ] THREAD_REPLAY_SAFE: Tool renderers detect completed-vs-active state from surrounding messages
- [ ] CAPABILITY_INJECTION: Display-only tools need no capabilities (pure functions), but follow the binding pattern
- [ ] UI_COMPONENT_PIPELINE: Cards use kit wrappers, not direct vendor imports

## Phased Delivery

### P0 (Crawl) — Display-only tools + multi-turn

1. 4 display-only tool contracts in `@cogni/ai-tools`
2. `DAOFormationCard` tool renderer (reuses existing formation hooks)
3. `IdentityProposalCard` tool renderer (editable fields + confirm)
4. `node-creator` graph in catalog with system prompt
5. Basic `PRReviewCard` + `NodeSummaryCard`
6. Register all renderers via `makeAssistantToolUI` in thread

### P1 (Walk) — Formal HIL + automation

7. Wire HIL interrupt/resume into InProc runner (platform task, benefits all graphs)
8. Migrate display-only tools to proper interrupt points
9. Governance templates (v2 multi-holder)
10. External AI agent support (programmatic resume)
11. Deprecate `/setup/dao` wizard page

### P2 (Run) — Full lifecycle

12. Payment activation inline
13. Auto-merge on PR approval
14. Production deployment trigger (requires task.0247)

## Files

### Create

| File | Purpose |
|------|---------|
| `packages/ai-tools/src/node-creation/propose-identity.contract.ts` | Identity proposal tool contract |
| `packages/ai-tools/src/node-creation/request-formation.contract.ts` | DAO formation tool contract |
| `packages/ai-tools/src/node-creation/present-pr.contract.ts` | PR presentation tool contract |
| `packages/ai-tools/src/node-creation/present-summary.contract.ts` | Summary tool contract |
| `packages/ai-tools/src/node-creation/*.impl.ts` | Pure tool implementations (no I/O) |
| `packages/langgraph-graphs/src/graphs/operator/node-creator/graph.ts` | Graph factory |
| `packages/langgraph-graphs/src/graphs/operator/node-creator/prompts.ts` | System prompt |
| `apps/operator/src/features/ai/components/tools/DAOFormationCard.tsx` | Inline formation renderer |
| `apps/operator/src/features/ai/components/tools/IdentityProposalCard.tsx` | Identity proposal renderer |
| `apps/operator/src/features/ai/components/tools/PRReviewCard.tsx` | PR review renderer |
| `apps/operator/src/features/ai/components/tools/NodeSummaryCard.tsx` | Summary renderer |

### Modify

| File | Change |
|------|--------|
| `packages/langgraph-graphs/src/catalog.ts` | Add `node-creator` graph entry |
| `apps/operator/src/components/vendor/assistant-ui/thread.tsx` | Register tool renderers via `makeAssistantToolUI` |
| `apps/operator/src/bootstrap/ai/tool-bindings.ts` | Add display-only tool bindings |

### Reuse (no changes)

| File | What |
|------|------|
| `features/setup/daoFormation/formation.reducer.ts` | 9-phase FSM |
| `features/setup/daoFormation/txBuilders.ts` | Transaction argument builders |
| `features/setup/hooks/useDAOFormation.ts` | wagmi wiring |
| `features/setup/daoFormation/api.ts` | Server verification client |
| `app/api/setup/verify/route.ts` | Server verification endpoint |

## Validation

- [ ] "Create a new node" in chat → AI asks intake questions → calls `propose_node_identity`
- [ ] IdentityProposalCard renders with editable fields, mutability warning on token name/symbol
- [ ] `request_dao_formation` renders DAOFormationCard inline, wallet signing works without page navigation
- [ ] User clicks "Continue" after formation → sends structured result → AI processes and scaffolds
- [ ] Scaffolding executes autonomously (branch, copy, rename, wire, provision)
- [ ] PR created via VCS tools, `present_pr` renders summary in chat
- [ ] DNS configured, `present_node_summary` shows final status
- [ ] Thread replay: reloading page shows completed cards as static summaries, not re-triggered flows

## Related

- [Node Formation Spec](../../docs/spec/node-formation.md) — DAO formation design + chat-native section
- [Human-in-the-Loop Spec](../../docs/spec/human-in-the-loop.md) — formal pause/resume (P1 migration target)
- [new-node skill](../../.claude/skills/new-node/SKILL.md) — Claude Code v0 (manual orchestration)
- [Creating a New Node Guide](../../docs/guides/creating-a-new-node.md) — technical scaffolding steps
