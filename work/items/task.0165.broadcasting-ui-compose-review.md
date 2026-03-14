---
id: task.0165
type: task
title: "Broadcasting UI — compose draft + review posts"
status: done
priority: 1
rank: 2
estimate: 3
summary: Build the user-facing broadcasting pages — a compose form to create ContentMessage drafts, a dashboard listing broadcasts with status, a detail view showing platform posts, and a review action (approve/reject/edit) per post.
outcome: A user can navigate to /broadcasting, compose a draft targeting platforms, see their broadcasts with status indicators, drill into a message to see per-platform posts, and submit review decisions — all wired to the existing API routes.
spec_refs:
  - broadcasting-spec
assignees:
  - derekg1729
credit:
project: proj.broadcasting
branch: claude/research-broadcasting-integration-8p2DB
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-14
labels: [broadcasting, ui, crawl]
external_refs:
---

# Broadcasting UI — compose draft + review posts

## Context

The broadcasting domain layer (task.0159) delivers API routes for draft, list, status, and review — but no UI exists to use them. Without a UI, the pipeline is inaccessible. This task adds the minimum viable pages to make the broadcasting feature usable end-to-end.

**Governing spec:** [docs/spec/broadcasting.md](../../docs/spec/broadcasting.md)

## Requirements

1. **`/broadcasting` page** — authenticated route listing the user's content messages. Shows status, target platforms, creation date. Filterable by status. Uses `GET /api/v1/broadcasting` (with optional `?status=` query param).
2. **Compose form** — inline or modal form to create a new broadcast draft. Fields: body (textarea), title (optional), target platforms (multi-select from `PLATFORM_IDS`), media URLs (optional). Submits to `POST /api/v1/broadcasting`. On success, navigates to or reveals the new message.
3. **Detail view** — clicking a message shows its platform posts via `GET /api/v1/broadcasting/[messageId]`. Each post displays: platform, optimized body, status, risk level, review decision, external URL (if published).
4. **Review action** — for posts in `pending_review` status, show approve/reject/edit buttons. Edit shows a textarea pre-filled with `optimizedBody`. Submits to `POST /api/v1/broadcasting/[messageId]/posts/[postId]/review`.
5. **Navigation** — add `/broadcasting` to the app sidebar and proxy `APP_ROUTES`.
6. **Contracts used as source of truth** — all request/response shapes use `z.infer<>` from existing `broadcast.*.v1.contract.ts` files. No manual type re-declarations.

### Invariants (from spec)

- **MESSAGE_IS_PLATFORM_AGNOSTIC** — compose form body has no platform-specific formatting hints
- **REVIEW_BEFORE_HIGH_RISK** — HIGH-risk posts show risk badge and require explicit review action

### Out of Scope

- Side-by-side platform previews (Run phase)
- Content calendar / scheduling UI
- Engagement metrics display
- Temporal workflow integration (draft form just calls the API; workflow orchestration is task.0159 scope)

## Allowed Changes

- `apps/web/src/app/(app)/broadcasting/` — **create** (page.tsx, view.tsx, \_api/broadcasts.ts)
- `apps/web/src/features/layout/components/AppSidebar.tsx` — **modify** (add nav item)
- `apps/web/src/features/layout/components/footer-items.tsx` — **modify** (add link)
- `apps/web/src/proxy.ts` — **modify** (add `/broadcasting` to `APP_ROUTES`)
- `apps/web/src/contracts/broadcast.*.v1.contract.ts` — **read only** (import types, do not modify)

## Design

### Outcome

A user can compose broadcast drafts, monitor their status, and review platform posts — all from the app UI without needing API tools.

### Approach

**Solution**: Single-page dashboard at `/broadcasting` with inline expand for detail + review. Follows the exact pattern of `/work` (table list, status pills, URL-driven filters) and `/schedules` (CRUD with React Query mutations). No new components library — uses existing kit primitives (`Table`, `Select`, `Button`, `Input`, `Dialog`, `Badge`) plus plain `<textarea>` and `<input type="checkbox">` where shadcn primitives don't exist yet.

**Reuses**:

- `/work` view pattern: `page.tsx` (auth shell) → `view.tsx` (client, React Query, URL filters, Table)
- `/schedules/_api/` pattern: typed fetch wrappers per operation (GET list, POST create, GET detail, POST review)
- `@/contracts/broadcast.*.v1.contract.ts` for all types via `z.infer<>`
- `useMutation` + `useQueryClient().invalidateQueries()` from React Query (already a dep) for compose + review
- `Dialog` from shadcn for compose form modal (already available in kit)
- `Badge` for status pills and risk levels (already available)
- `ExpandableTableRow` from kit for inline detail view (already exists, avoids a separate page)

**Rejected**:

- **Separate `/broadcasting/[id]` page** — adds routing complexity for no benefit at Crawl scale. Inline expand (like `ExpandableTableRow`) is simpler and keeps context.
- **Feature-level hooks directory** (`features/broadcasting/hooks/`) — over-engineering. The `_api/` fetch functions + inline `useQuery`/`useMutation` in the view component is the established pattern. Hooks would be a premature abstraction for 4 fetch functions.
- **Custom feature components** (`features/broadcasting/components/`) — at Crawl, the entire UI fits in ~2 files: `view.tsx` (list + compose) and an inline detail/review expansion. Splitting into 4+ component files is premature. If the UI grows in Walk, extract then.

### Architecture

```
apps/web/src/app/(app)/broadcasting/
  page.tsx          ← auth shell (same as /work/page.tsx)
  view.tsx          ← "use client" — list, compose dialog, inline detail/review
  _api/
    broadcasts.ts   ← all 4 fetch functions in one file (they're ~15 lines each)
```

No `features/broadcasting/` directory needed at Crawl. The view is ~200 lines of presentation with no business logic — it just calls API endpoints and renders responses. When the UI grows (Walk: previews, campaigns, engagement), extract components then.

### Invariants

- [ ] MESSAGE_IS_PLATFORM_AGNOSTIC: compose form body is a plain textarea with no platform-specific hints, labels, or character counters (spec: broadcasting-spec)
- [ ] REVIEW_BEFORE_HIGH_RISK: risk level badge shown on each platform post; review buttons only appear for `pending_review` posts (spec: broadcasting-spec)
- [ ] CONTRACTS_ARE_TRUTH: all request/response types are `z.infer<>` from `broadcast.*.v1.contract.ts` — no manual interfaces (spec: architecture)
- [ ] KIT_IS_ONLY_API: UI uses `@/components` barrel exports only, never direct vendor imports (spec: architecture)
- [ ] SIMPLE_SOLUTION: ~3 new files total, no new npm deps, no new component directories
- [ ] ARCHITECTURE_ALIGNMENT: `page.tsx` → `view.tsx` → `_api/` follows established `/work` and `/schedules` patterns (spec: architecture)

### Files

- Create: `apps/web/src/app/(app)/broadcasting/page.tsx` — auth shell (5 lines, same as work/page.tsx)
- Create: `apps/web/src/app/(app)/broadcasting/view.tsx` — client view: list table, compose dialog, inline detail expand with review actions
- Create: `apps/web/src/app/(app)/broadcasting/_api/broadcasts.ts` — 4 typed fetch functions (fetchList, createDraft, fetchStatus, submitReview)
- Modify: `apps/web/src/proxy.ts` — add `/broadcasting` to `APP_ROUTES` array
- Modify: `apps/web/src/features/layout/components/AppSidebar.tsx` — add nav item (`Radio` icon from lucide)
- Modify: `apps/web/src/features/layout/components/footer-items.tsx` — add Broadcasting link

## Plan

### 1. Wiring (nav + auth)

- [x] Add `/broadcasting` to `APP_ROUTES` in `proxy.ts`
- [x] Add nav item to `AppSidebar.tsx` (`{ href: "/broadcasting", label: "Broadcast", icon: Radio }`)
- [x] Add link to `footer-items.tsx`
- [x] Create `broadcasting/page.tsx` — auth shell identical to work/page.tsx

### 2. API fetch functions

- [x] Create `broadcasting/_api/broadcasts.ts` with 4 functions:
  - `fetchBroadcasts(status?: string)` → `GET /api/v1/broadcasting[?status=]`
  - `createDraft(input: BroadcastDraftInput)` → `POST /api/v1/broadcasting`
  - `fetchBroadcastStatus(messageId: string)` → `GET /api/v1/broadcasting/[messageId]`
  - `submitReview(messageId: string, postId: string, input: BroadcastReviewInput)` → `POST .../review`

### 3. View component

- [x] Create `broadcasting/view.tsx` ("use client") with:
  - **List**: `useQuery` for `fetchBroadcasts`, `Select` for status filter, `Table` with columns: body (truncated), status `Badge`, platforms, createdAt
  - **Compose**: `Dialog` with form (body `<textarea>`, title `Input`, platforms `ToggleGroup`, optional mediaUrls). `useMutation` → `createDraft`, invalidate on success
  - **Detail expand**: `ExpandableTableRow` wrapping a child component that calls `useQuery(fetchBroadcastStatus)` on mount (lazy fetch — only when expanded). Show each post: platform, optimizedBody, status, riskLevel `Badge`, reviewDecision
  - **Review**: for `pending_review` posts, `Button` approve/reject + inline edit `<textarea>`. `useMutation` → `submitReview`, invalidate on success

### 4. Validate

- [x] `pnpm check` passes
- [ ] Manual: `/broadcasting` renders, compose creates draft, detail expands, review submits

## Validation

**Commands:**

```bash
pnpm check                   # lint + type + format (CI-fast)
```

**Expected:** All pass with zero errors.

**Manual verification:**

- Navigate to `/broadcasting` while authenticated — page renders, sidebar link highlighted
- Submit compose form → new message appears in list with status `draft`
- Click message → detail view shows message body and empty posts list
- Unauthenticated → redirects to `/`

## Review Checklist

- [ ] **Work Item:** `task.0165` linked in PR body
- [ ] **Spec:** `MESSAGE_IS_PLATFORM_AGNOSTIC` upheld in compose form
- [ ] **Spec:** `REVIEW_BEFORE_HIGH_RISK` — risk level visible, review action available
- [ ] **Contracts:** all types imported via `z.infer<>` from contract files
- [ ] **Architecture:** no direct adapter imports from UI; uses API fetch only
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
