---
id: ux-premium-frontend
type: research
title: "Premium Frontend UX — Activity Stream, Work Items, Agent Visualization"
status: active
trust: draft
summary: Research on delivering top-tier frontend UX for chat activity, work items, and agent visualization
read_when: Implementing chat activity indicators, work items table upgrades, or agent visualization
owner: derekg1729
created: 2026-03-30
verified: 2026-03-30
tags: [ui, ux, research]
---

# Research: Premium Frontend UX — Activity Stream, Work Items, Agent Visualization

> spike: spike.0234 | date: 2026-03-30

## Question

How do we deliver a top-tier frontend UX for our three core surfaces: (1) work item management, (2) real-time AI activity stream in chat, and (3) agent visualization — starting from what we already have and building toward Three.js-powered agent visuals?

## Context

### What exists today

**Work items table** (`/work`): Functional but basic. HTML table with type/status/priority filters, search, URL-driven state. No row actions, no inline editing, no project grouping, no detail panel. Data fetched via React Query (30s stale).

**Chat** (`/chat`): Uses `@assistant-ui/react` with AI SDK streaming. When the AI is processing, there's **no activity indicator** — the user sees nothing until `text_delta` chunks arrive. The `StatusEvent` type exists in the contract (`phase: "thinking" | "tool_use" | "compacting"`) and is mapped to `data-status` chunks in the chat route, but **no UI component consumes it**. The "thinking" state is invisible.

**Dashboard** (`/dashboard`): `RunCard` components show run status with pulsing dots, elapsed timers, status badges. `statusLabel` field exists but is always `null` (V0). No live streaming content yet (P1 of proj.live-dashboard).

**Backend streaming**: Complete. `StatusEvent` → Redis Streams → SSE → `data-status` chunk pipeline works. The gap is purely frontend.

### Tech stack

- React 19 + Next.js 16 (App Router)
- Tailwind CSS 4.1 + shadcn/ui + Radix UI
- @assistant-ui/react + AI SDK 6.0
- Recharts (charts), Framer Motion (animation)
- @tanstack/react-query (server state)
- No Three.js currently installed

### Related projects

- **proj.live-dashboard** (Active, P1) — Live streaming cards, phase badges, progressive disclosure
- **proj.unified-graph-launch** (Active, P1) — Three-plane architecture (Temporal/Redis/Postgres), SSE endpoints
- **proj.workflow-building-monitoring** (Active, P2) — Admin CRUD for Temporal schedules

## Findings

### 1. Chat Activity Stream (replacing invisible "thinking")

**Problem**: When the AI is working, the user sees nothing. No "thinking" indicator, no tool use display, no progress signal. This is the single biggest UX gap.

**What we have**: `StatusEvent { phase: "thinking" | "tool_use" | "compacting", label?: string }` is already emitted by the backend, transported through Redis Streams, and delivered as `data-status` transient chunks. The frontend just doesn't render it.

#### Option A: 1-line activity ticker above composer (Recommended)

- **What**: A single animated line between the last message and the composer that shows the current agent phase. Examples: "Thinking...", "Using search_web...", "Compacting context...". Replaces the void with a tight status line.
- **Implementation**: Subscribe to `data-status` chunks in `@assistant-ui/react`'s runtime. Render a `<StatusLine>` component that fades in/out with Framer Motion. Show phase icon + label. Auto-dismiss on `text_delta` or `done`.
- **Pros**: Minimal code (~50 LOC component). Uses existing backend pipeline. Immediate high-impact UX improvement.
- **Cons**: Limited information density. No historical view of what tools were called.
- **OSS tools**: `@assistant-ui/react` already supports transient status via its runtime API. Framer Motion for enter/exit animations.
- **Fit**: Direct consumption of existing `StatusEvent` → `data-status` pipeline. Zero backend changes.

#### Option B: Expandable activity log

- **What**: The 1-line ticker can expand to show a scrollable log of all status events in the current turn (tool calls, thinking phases, timing).
- **Pros**: Richer visibility for power users. Debug-friendly.
- **Cons**: More complex state management. Needs accumulation of transient events.
- **Fit**: Build as enhancement on top of Option A.

### 2. Work Items Table

**Problem**: The current table is functional but reads as "admin spreadsheet." Needs polish for a premium feel.

#### Option A: Enhanced table with TanStack Table (Recommended)

- **What**: Replace the hand-rolled table with `@tanstack/react-table` for sorting, column resizing, row selection, keyboard navigation. Add a slide-out detail panel.
- **Pros**: Battle-tested, excellent a11y, virtual scrolling for large lists, column visibility toggle.
- **Cons**: Migration effort from current hand-rolled table.
- **OSS tools**: `@tanstack/react-table` v8 (already have `@tanstack/react-query`). `cmdk` (already installed) for command palette search.
- **Fit**: Drop-in replacement for the existing `<Table>` usage in `work/view.tsx`.

#### Enhancements to include

1. **Row click → detail panel** (slide-out or modal) showing full work item metadata, linked PRs, spec refs
2. **Grouped by project** — collapsible project sections with aggregate counts
3. **Inline status transitions** — click status pill to advance (needs_design → needs_implement)
4. **Assignee avatars** — GitHub avatar next to assignee handle
5. **Keyboard shortcuts** — j/k navigation, / to search, enter to open

### 3. Graph Runs Sharing the Activity Stream

**Problem**: The dashboard shows run cards with polling, but there's no live content streaming. The chat shows streaming text but no status events. These should share the same activity signal.

#### Option A: Unified StatusEvent consumer (Recommended)

- **What**: Create a shared `useRunActivity(runId)` hook that connects to `GET /api/v1/ai/runs/{runId}/stream` (SSE) and exposes the latest `StatusEvent`. Both the chat status line and dashboard run cards consume the same hook.
- **Implementation**: Hook wraps `EventSource` with reconnection (Last-Event-ID). Returns `{ phase, label, lastTextPreview }`. Chat's `StatusLine` uses it. Dashboard's `RunCard` uses it for the `statusLabel` field (currently null).
- **Pros**: DRY. Single reconnection/backoff logic. Same real-time signal everywhere.
- **Cons**: Chat already gets events through the AI SDK stream — need to decide if chat uses the SDK stream or the shared hook (SDK stream is better for chat, hook is better for dashboard).
- **Fit**: Dashboard cards become live (proj.live-dashboard P1). Chat gets activity indicator. Same backend endpoint.

### 4. Three.js Agent Visualization (Future)

**Problem**: The user wants "top 0.1% frontend design" with cute animated agents. Three.js is the target.

#### Option A: Progressive enhancement — terminal status line → 2D sprites → 3D (Recommended)

**Phase 1 (Now)**: 1-line activity ticker in chat + live `statusLabel` on dashboard cards. Pure CSS/Framer Motion. Zero new deps.

**Phase 2 (Walk)**: Animated 2D agent avatars using Lottie or Rive. Each graph/agent type gets a character with idle/thinking/working/done animations. Small enough to embed in run cards and chat.

- **OSS tools**: `@lottiefiles/react-lottie-player` or `@rive-app/react-webgl2`. Both are lightweight and GPU-accelerated.
- **Pros**: Cute, performant, works on mobile. Rive files are tiny (<50KB per animation).
- **Cons**: Requires animation asset creation (design work).

**Phase 3 (Run)**: Three.js scene for a dedicated "agent observatory" page. Agents as 3D characters in an isometric workspace. Real-time activity drives animations.

- **OSS tools**: `@react-three/fiber` + `@react-three/drei` (React bindings for Three.js). `three.js` for the runtime. `@react-spring/three` for physics-based animation.
- **Pros**: Stunning visual differentiation. "Top 0.1%" territory.
- **Cons**: Heavy bundle (~200KB gzipped for Three.js). Requires 3D modeling pipeline. GPU load on mobile.
- **Fit**: Route-split and lazy-loaded. Only loads on `/observatory` or similar. Doesn't affect core app performance.

#### Option B: Skip 2D, go straight to Three.js

- **Pros**: No throwaway work on 2D assets.
- **Cons**: Longer time to first visual. Three.js is overkill for a status indicator in chat.
- **Not recommended**: The 1-line ticker + Rive avatars deliver 90% of the delight at 10% of the cost.

## Recommendation

**Crawl → Walk → Run:**

1. **Crawl (immediate, 1-2 PRs)**: Chat activity status line + dashboard `statusLabel` wiring. Zero new dependencies. Fixes the "invisible thinking" gap. Unblocks proj.live-dashboard P1 phase badges.

2. **Walk (next sprint)**: Work items table upgrade with TanStack Table, detail panel, keyboard nav. Animated 2D agent avatars (Rive/Lottie) on run cards.

3. **Run (future)**: Three.js agent observatory. Dedicated page with 3D agent characters driven by real-time activity streams.

**Project structure**: Create `proj.premium-frontend-ux` to own the cross-cutting UX improvements. Items 1 and 3 above are already partly covered by `proj.live-dashboard` P1 — but the chat status line, work table upgrade, and agent visualization are new scope that deserves its own project. Keep `proj.live-dashboard` focused on the dashboard surface; the new project handles chat UX, work items UX, and agent visualization.

## Open Questions

1. **Asset pipeline**: Who creates the Rive/Lottie agent animations for Phase 2? Need a designer or generative tool.
2. **assistant-ui status API**: Does `@assistant-ui/react` expose a hook for transient `data-status` chunks, or do we need to intercept at the runtime level? Needs a quick prototype.
3. **Three.js scope**: What does the "agent observatory" actually show? Live agents working? Historical activity replay? Both? Needs UX design before engineering.
4. **Mobile**: Three.js scene needs careful performance budgeting on mobile. May want to fallback to 2D on low-power devices.

## Proposed Layout

### Project

**`proj.premium-frontend-ux`** — Premium UX for chat activity, work items, and agent visualization.

- **Crawl (P0)**: Chat activity status line, dashboard statusLabel integration
- **Walk (P1)**: Work items table upgrade, 2D agent avatars
- **Run (P2)**: Three.js agent observatory

### Specs

- No new specs needed for P0 (uses existing StatusEvent contract)
- P1: Update work items API contract if inline status transitions are added
- P2: New spec for Three.js observatory page (data flow, performance budget, lazy loading)

### Tasks (rough)

| ID | Title | Phase | Est |
|----|-------|-------|-----|
| task.0235 | Chat activity status line — consume StatusEvent in thread UI | P0 | 2 |
| task.0236 | Dashboard statusLabel wiring — RunCard shows live phase from SSE | P0 | 2 |
| task.0237 | Work items table — TanStack Table migration + detail panel | P1 | 3 |
| task.0238 | Agent avatars — Rive/Lottie animated characters on run cards | P1 | 3 |
| spike.0239 | Three.js observatory — prototype + performance budget | P2 | 2 |
