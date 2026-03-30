---
id: bug.0233
type: bug
title: "Broadcasting UI is unusable — echo-only output, no publish action, confusing auto-approve/risk UX"
status: needs_triage
priority: 1
rank: 1
estimate: 5
summary: Broadcasting page ships internal state machine jargon to users ("approved", "risk level", "review"), shows echo adapter output ("[x] your text") instead of AI-generated content, has no "Post" or "Publish" button, no ability to regenerate posts, and no visible graph execution. The feature is non-functional as a user-facing tool.
outcome: A user can compose content, see AI-adapted posts per platform, edit/regenerate each, and click a clear "Publish" button that posts to connected platforms.
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
created: 2026-03-30
updated: 2026-03-30
labels: [broadcasting, ux, ui]
external_refs:
---

# Broadcasting UI is unusable — echo-only output, no publish action, confusing auto-approve/risk UX

## Requirements

### 1. Echo adapter output — no AI content generation

**Observed:** Posts show `[blog] cogni DAO will take over the world` — just the platform name prepended to the raw input. The `GraphContentOptimizerAdapter` was wired but falls back to the echo adapter when the graph execution fails or skill docs aren't found.

**Root cause:** `apps/web/src/adapters/server/broadcast/graph-content-optimizer.adapter.ts:38-42` resolves skill docs via `process.cwd()` which may not be the monorepo root. The fallback at L72-79 silently returns echo output instead of surfacing the error.

**Expected:** Each platform post should contain AI-adapted content using the platform skill guides. Failures should be visible, not silent.

### 2. No "Publish" or "Post" button

**Observed:** When posts are `approved` (auto-approved for low risk), there is no button to actually publish them. Publishing only happens as a side-effect buried in the review/approve flow (`apps/web/src/app/api/v1/broadcasting/[messageId]/posts/[postId]/review/route.ts:116-146`).

**Code:** `apps/web/src/app/(app)/broadcasting/view.tsx:231` — action buttons only render when `post.status === "pending_review"`. Approved posts show no actions at all.

**Expected:** Every post ready to publish should have a clear "Publish" / "Post" button.

### 3. Confusing auto-approve and risk assessment UX

**Observed:** Posts auto-approve to "approved" status immediately on creation if "low risk." The risk assessment (`packages/broadcast-core/src/rules.ts:79-98`) flags URLs as "high risk" — meaning most useful content triggers `pending_review` while trivial content auto-approves. Users see "approved" / "low risk" badges with no context.

**Problems:**

- "approved" implies human review — nobody reviewed, it's a heuristic
- "low risk" / "high risk" are internal concepts exposed raw
- URLs = high risk penalizes normal social media posts
- Auto-approve dead-ends — no visible next action

**Expected:** User controls when posts are published. Risk informs the UI, not gates the workflow. Status labels should be user-friendly ("Ready to post", "Needs review", "Posted").

### 4. No edit or regenerate capability for approved posts

**Observed:** Edit button only appears on `pending_review` posts (`view.tsx:231`). Once auto-approved, no editing or regeneration possible.

**Expected:** Users should be able to edit any post before publishing and regenerate (re-run optimizer) for any post.

### 5. Graph runs not visible

**Observed:** No indication that graph execution happened or failed. Optimizer logs failures at warn level but UI shows no error state, no loading indicator, no link to graph runs.

**Expected:** Loading state during optimization. Error state on failure. Links to graph runs for transparency.

## Allowed Changes

- `apps/web/src/app/(app)/broadcasting/view.tsx` — UI overhaul
- `apps/web/src/app/(app)/broadcasting/_api/broadcasts.ts` — new API calls
- `apps/web/src/app/api/v1/broadcasting/` — new publish endpoint or route changes
- `apps/web/src/adapters/server/broadcast/graph-content-optimizer.adapter.ts` — fix skill doc resolution
- `packages/broadcast-core/src/rules.ts` — fix risk heuristics
- `packages/broadcast-core/src/types.ts` — possible status label changes

## Plan

- [ ] Fix graph optimizer skill doc resolution so AI content actually generates
- [ ] Add explicit "Publish" button for approved/ready posts
- [ ] Add "Regenerate" button to re-run optimizer per post
- [ ] Allow editing any unpublished post (not just pending_review)
- [ ] Replace state machine jargon with user-friendly labels in UI
- [ ] Fix risk heuristic (URLs should not auto-block)
- [ ] Show loading state during optimization
- [ ] Show error state when optimization fails

## Validation

**Command:**

```bash
pnpm check
```

**Manual verification:**

- Create a draft — posts show AI-adapted content (not echo `[platform]` prefix)
- Posts have a visible "Publish" button
- User can edit any post before publishing
- User can regenerate a post
- Status labels are human-readable
- Short content with URLs does not auto-block

## Review Checklist

- [ ] **Work Item:** `bug.0233` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Upstream PR: https://github.com/Cogni-DAO/node-template/pull/581
- Handoff: [handoff](../handoffs/bug.0233.handoff.md)

## Attribution

-
