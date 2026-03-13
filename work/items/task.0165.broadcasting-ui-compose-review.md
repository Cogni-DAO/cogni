---
id: task.0165
type: task
title: "Broadcasting UI — compose draft + review posts"
status: needs_implement
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
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
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

- `apps/web/src/app/(app)/broadcasting/` — **create** (page.tsx, view.tsx, \_api/)
- `apps/web/src/features/broadcasting/components/` — **create** (compose form, message list, post detail, review form)
- `apps/web/src/features/broadcasting/hooks/` — **create** (React Query hooks for broadcast API)
- `apps/web/src/features/layout/components/AppSidebar.tsx` — **modify** (add broadcasting nav item)
- `apps/web/src/features/layout/components/footer-items.tsx` — **modify** (add broadcasting link)
- `apps/web/src/proxy.ts` — **modify** (add `/broadcasting` to `APP_ROUTES`)
- `apps/web/src/contracts/broadcast.*.v1.contract.ts` — **read only** (import types, do not modify)

## Plan

### 1. Navigation + Route Shell

- [ ] Add `/broadcasting` to `APP_ROUTES` in `proxy.ts`
- [ ] Add broadcasting item to `AppSidebar.tsx` nav links (icon: `Megaphone` or `Radio` from lucide)
- [ ] Add broadcasting link to `footer-items.tsx`
- [ ] Create `apps/web/src/app/(app)/broadcasting/page.tsx` — auth check + render view

### 2. API Client Hooks

- [ ] Create `apps/web/src/app/(app)/broadcasting/_api/fetchBroadcasts.ts` — `GET /api/v1/broadcasting`
- [ ] Create `apps/web/src/app/(app)/broadcasting/_api/createDraft.ts` — `POST /api/v1/broadcasting`
- [ ] Create `apps/web/src/app/(app)/broadcasting/_api/fetchBroadcastStatus.ts` — `GET /api/v1/broadcasting/[messageId]`
- [ ] Create `apps/web/src/app/(app)/broadcasting/_api/submitReview.ts` — `POST /api/v1/broadcasting/[messageId]/posts/[postId]/review`

### 3. Compose Form

- [ ] Create `apps/web/src/features/broadcasting/components/ComposeForm.tsx`
- [ ] Fields: body (textarea, max 5000), title (input, optional), targetPlatforms (checkbox group), mediaUrls (URL input list, optional)
- [ ] Submit handler calls `createDraft`, invalidates query cache
- [ ] Validation via Zod schema from `broadcast.draft.v1.contract`

### 4. Message List View

- [ ] Create `apps/web/src/app/(app)/broadcasting/view.tsx` — client component
- [ ] React Query hook for `fetchBroadcasts` with status filter
- [ ] Status filter dropdown (same pattern as work dashboard)
- [ ] Table or card list: body preview, status pill, platforms, createdAt
- [ ] Click row → expand or navigate to detail

### 5. Detail + Review View

- [ ] Create `apps/web/src/features/broadcasting/components/MessageDetail.tsx`
- [ ] Fetch message + posts via `fetchBroadcastStatus`
- [ ] Show message metadata (body, title, platforms, status)
- [ ] List platform posts with: platform icon, optimized body, status pill, risk badge, review decision
- [ ] For `pending_review` posts: approve/reject buttons + edit textarea
- [ ] Submit review calls `submitReview`, invalidates query cache

### 6. Validate

- [ ] `pnpm check` — lint, types, format pass
- [ ] Manual: navigate to `/broadcasting`, compose a draft, see it in the list
- [ ] Manual: view message detail, see platform posts (if any exist from API/workflow)

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
