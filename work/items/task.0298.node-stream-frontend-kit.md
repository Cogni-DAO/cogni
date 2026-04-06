---
id: task.0298
type: task
title: "Node stream frontend kit — useNodeStream hook + StreamCard + event renderers"
summary: "Reusable SSE consumer hook and presentational components for real-time node event streams. One hook, one card shell, per-type content components."
outcome: "Operator dashboard shows live health status from the node stream. Adding a new event type to any dashboard requires one new content component and zero hook/infra changes."
status: done
priority: 0
rank: 1
estimate: 3
actor: ai
project: proj.operator-plane
project_id: proj.operator-plane
assignees: []
spec_refs:
  - data-streams-spec
  - architecture-spec
branch: feat/task-0281-node-streams-pkg
created: 2026-04-05
updated: 2026-04-05
revision: 0
---

# Node Stream Frontend Kit

## Context

The backend streams exist: `GET /api/v1/node/stream` returns SSE events per node (health, CI, deploy, market snapshots). No frontend consumer exists. The codebase has zero `EventSource` usage — chat uses AI SDK's `DefaultChatTransport`, dashboard polls via React Query. This task adds the first SSE consumer hook and reusable card components.

## Design

### Outcome

Operator dashboard renders a live health indicator from the node stream. Poly dashboard can render market snapshots from the same hook. Adding a 5th, 10th, or 50th event type requires only a new `*EventContent` component.

### Approach

**Solution**: Three pieces — one hook, one card shell, per-type content components.

**Reuses**: Native `EventSource` API (browser-standard SSE client with auto-reconnect), existing `Card`/`Badge` kit components (CVA variants), existing feature directory pattern (`features/node-stream/`).

**Rejected**:

- React Query polling to SSE endpoint — wrong tool. EventSource IS the subscription. React Query is request/response.
- `NodeStreamProvider` context wrapper — unnecessary indirection for a single hook.
- Generic event renderer registry/map — premature for 4 event types. Just switch on `event.type`.
- WebSocket upgrade — SSE auto-reconnects natively, sufficient for unidirectional push.

### Invariants

- [ ] SSE_RESUME_SAFE: Hook passes `Last-Event-ID` on reconnect (native EventSource behavior)
- [ ] GENERIC_PORT: Hook returns `NodeEventBase` — event-specific typing at the consumer level
- [ ] PRESENTATIONAL_CARDS: Content components receive typed event as props, no fetching
- [ ] NO_PROVIDER_WRAPPER: Hook is standalone, no React Context layer
- [ ] KIT_REUSE: Card shell uses existing Card/Badge/cn() — no new design system primitives

### Files

**Shared (node-template, inherited by all nodes):**

- Create: `features/node-stream/hooks/useNodeStream.ts` — EventSource hook
- Create: `features/node-stream/components/StreamCard.tsx` — card shell (dot + badge + age + children)
- Create: `features/node-stream/components/HealthEventContent.tsx` — health renderer
- Create: `features/node-stream/components/CiStatusEventContent.tsx` — CI renderer
- Create: `features/node-stream/components/DeployEventContent.tsx` — deploy renderer
- Create: `features/node-stream/index.ts` — barrel export

**Poly-specific:**

- Create: `nodes/poly/app/src/features/node-stream/components/SnapshotEventContent.tsx` — market snapshot renderer

**Integration (proof it works):**

- Modify: `nodes/operator/app/src/app/(app)/dashboard/view.tsx` — add health card section

### Hook API

```typescript
interface UseNodeStreamResult {
  /** SSE connection state */
  status: "connecting" | "open" | "closed" | "error";
  /** Last N events (ring buffer, default 50) */
  events: NodeEventBase[];
  /** Latest event per type — O(1) lookup */
  latest: Map<string, NodeEventBase>;
}

function useNodeStream(opts?: {
  /** Disable the connection (e.g., when tab is hidden) */
  enabled?: boolean;
  /** Ring buffer size (default 50) */
  bufferSize?: number;
}): UseNodeStreamResult;
```

Under the hood: `new EventSource("/api/v1/node/stream")`. EventSource handles reconnect + Last-Event-ID natively. Hook manages a `useRef` ring buffer + `useState` for latest-by-type map. Cleanup on unmount via `eventSource.close()`.

### StreamCard API

```typescript
interface StreamCardProps {
  event: NodeEventBase | undefined;
  children: React.ReactNode;
  className?: string;
}
```

Renders: status dot (green/yellow/red based on recency — event <2min old = green, <5min = yellow, else red), event type badge, source label, relative age ("12s ago"). Children slot for event-specific content. When `event` is undefined, renders a skeleton/empty state.

## Validation

```
1. Start dev:stack (Redis + app)
2. Health publisher fires every 60s → Redis → SSE
3. Open operator dashboard → useNodeStream connects
4. HealthEventContent renders status pill + latency
5. Kill readyz → health event shows "down" → card dot turns red
```
