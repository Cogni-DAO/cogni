---
id: task.0425
type: task
title: "Stage 1 — Send-to-Cogni POC: shadcn widget + work-items API on operator's (app)/error.tsx"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "Smallest credible POC of the cross-surface 'Send to Cogni' standard, scoped to *one* surface on *one* node. Builds a shadcn-composed `<SendToCogniWidget />` in a new `packages/send-to-cogni/` shared package, posts to `POST /api/v1/work/items` (PR #1130), and wires into operator's `(app)/error.tsx` only. Deletes the v0-of-v0 substrate (custom `error_reports` table + custom route + custom contract + custom button) in the same PR. Stage 2 (chat error bubble), Stage 3 (AI thumbs-down feedback), and Stage 4 (poly cross-node) are deferred — see the staged plan below."
outcome: "On candidate-a, hitting `/dev/boom` (signed in) renders the new shadcn widget; clicking it files a real `bug.5xxx` work item via the Doltgres API and shows a Sonner toast with the id. The bug appears in `GET /api/v1/work/items?type=bug&node=operator`. Zero new deps, zero new contracts, zero new tables — the v0-of-v0 bespoke substrate is deleted. The widget + hook + ErrorContext type live in a shared package, ready for Stage 2-4 to consume without re-implementing."
spec_refs:
  - docs/spec/observability.md
assignees: derekg1729
credit:
project: proj.observability-hardening
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0423]
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [frontend, ux, observability, error-handling, oss-first, stage-1-poc]
external_refs:
  - work/items/task.0426.send-to-cogni-error-intake-v0.md
  - work/items/story.0417.ui-send-to-cogni-error-button.md
  - https://github.com/Cogni-DAO/node-template/pull/1130
  - nodes/operator/app/src/features/ai/components/ChatErrorBubble.tsx
---

# Stage 1 — Send-to-Cogni POC

## Problem

Two parallel realities make v0-of-v0 (PR #1121, task.0426) obsolete
the moment it ships:

1. **PR #1130** is landing `POST /api/v1/work/items` on operator —
   Doltgres-backed, auth-required, `dolt_commit`-audited. That's the
   right backing store for "agent files a bug from a UI error."
2. **shadcn primitives in operator** (`Popover`, `Form`, `Textarea`,
   `Button`, `Sonner`) compose into a 1-click feedback widget with
   zero new deps. There is no third-party feedback library that
   beats this without dragging in a hosted backend (Sentry,
   Feedback Fish, etc.).

But going from v0-of-v0 → "a working widget on every error surface
across every node" is not a single PR. The review-design pass on
this task surfaced three real blockers (cross-node placement, poly
having no work-items endpoint, error-shape mismatch). Doing them
all at once is the bespoke-vs-cross-cutting trap. **This task is
just Stage 1 — the smallest end-to-end POC that proves the
abstraction in production.**

## Staged plan (where this fits)

| Stage | What                                                 | Surface(s)                        | Owns                                                              |
| ----- | ---------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| **0** | v0-of-v0 substrate (full-page button, custom intake) | `/dev/boom` only                  | task.0426 (PR #1121) — ship as-is                                 |
| **1** | Real widget POC, shared-package home                 | `(app)/error.tsx` (operator only) | **this task**                                                     |
| **2** | Chat error bubble integration                        | `ChatErrorBubble`                 | new task (blocked_by Stage 1 + ErrorContext.kind="chat")          |
| **3** | AI thumbs-down feedback (vNext)                      | assistant message action row      | new task (blocked_by Stage 2 + adds ErrorContext.kind="feedback") |
| **4** | Poly cross-node                                      | poly close-order error toast      | new task (blocked_by cross-node endpoint decision)                |

Stages 2–4 each add **one** thing to the same widget — a new
`ErrorContext.kind` discriminant + a new wire site. No re-design.
Spawn-on-demand, not preemptive.

## When/where/how the widget surfaces (the user-experience map)

- **Stage 1 — route boundary** (`error.tsx`): user navigates to a
  route whose RSC throws → Next renders the boundary with a
  recovery card → widget is embedded inline below the "Try again"
  button. **`variant="page"`** — no popover, just an inline form.
- **Stage 2 — chat error bubble**: chat assistant turn fails (LLM
  error, tool failure, rate limit) → `ChatErrorBubble` shows the
  error → small "Send to Cogni" button next to "Retry" opens a
  Popover with the form. **`variant="popover"`** — the chat layout
  doesn't have room for an inline form.
- **Stage 3 — AI thumbs-down (vNext)**: user clicks 👎 on an
  assistant turn → the same Popover opens, pre-filled with the
  conversation context, but submitted as `type="bug"` with
  `labels=["ai-feedback","thumbs-down"]` and the surrounding turn
  payload in the body. Same widget, new `ErrorContext.kind="feedback"`
  branch in the hook.
- **Stage 4 — poly trade error toast**: a Sonner toast for
  "couldn't close order" gets a "Send to Cogni" action button →
  Popover. **`variant="popover"`** with `ErrorContext.kind="fetch"`
  carrying `{ method, url, status, body }`.
- **Future surfaces** (any toast.error, any form mutation, any
  fetch wrapper): consume `useSendToCogni()` + render
  `<SendToCogniWidget variant="popover" context={...} />`. Standard
  already enforced.

## Design

### Outcome (Stage 1 only)

A signed-in user hits `/dev/boom` (operator), sees the
`(app)/error.tsx` boundary render with the new shadcn widget
embedded, types a sentence, clicks **Send to Cogni**, and sees a
Sonner toast: "Filed bug.5042 — operator will look at it." The row
exists in Doltgres `work_items`, queryable via
`GET /api/v1/work/items?type=bug&node=operator`.

### Approach

A single client component in a new shared package, one variant in
Stage 1, designed so Stages 2–4 plug in without rewrites.

**Solution**:

1. New shared package `packages/send-to-cogni/` (per packages-architecture's
   ">1 runtime → shared package" rule — every node will eventually
   import this).
2. The package exports:
   - `<SendToCogniWidget />` (client component, three variants but
     **only `page` rendered in Stage 1**).
   - `useSendToCogni()` hook — builds the work-items payload and
     POSTs.
   - `ErrorContext` discriminated union — the prop the widget
     accepts. Stage 1 ships only `kind: "next-render"`; Stages 2–4
     add `chat | feedback | fetch`.
   - `buildWorkItemFromError(ctx)` — pure function, easy to unit-test.
3. Operator's `(app)/error.tsx` constructs an
   `ErrorContext.kind="next-render"` from `error` / `error.digest` /
   `pathname` and passes it to the widget.

**ErrorContext shape (Stage 1):**

```ts
type ErrorContext = {
  kind: "next-render";
  error: Error & { digest?: string };
  route: string;
  node: string;
};
// Stage 2:
// | { kind: "chat"; chatError: ChatError; threadId?: string; node: string }
// Stage 3:
// | { kind: "feedback"; assistantMessageId: string; threadId: string; sentiment: "down" | "up"; node: string }
// Stage 4:
// | { kind: "fetch"; method: string; url: string; status: number; body?: string; node: string }
```

The hook normalizes any `ErrorContext` into one
`WorkItemsCreateInput` shape — see "Wire format" below.

**Reuses (zero new deps):**

- `Popover`, `Form`, `Textarea`, `Button`, `Sonner` — already in
  operator's shadcn install.
- `POST /api/v1/work/items` — PR #1130's endpoint. Server allocates
  `bug.5xxx` id, server-resolved auth, `dolt_commit` audit.
- `WorkItemsCreateInput` Zod from `@cogni/node-contracts`.
- Pino structured log at the route handler — already emits
  `event="..."`; the new server-side bridge (or the work-items
  route itself, if PR #1130 lands the log) carries the `digest`.
- Operator's `(app)/error.tsx` (already present in repo).
- `nodes/operator/app/src/app/(public)/dev/boom/page.tsx` (forced
  error route, kept from task.0426).

**Rejected alternatives:**

- **Sentry User Feedback / Feedback Fish / FeedbackFin.** All tie
  to a hosted backend; Cogni's storage is Doltgres work-items.
  Bridging back is itself a project.
- **Build a headless `<ErrorReport>` compound component family
  now.** Premature. shadcn `Popover` + a single component cover the
  three v1 variants in <100 LOC.
- **Wire all four surfaces in one PR.** Surfaced as a 🔴 in the
  review-design pass — too many moving parts, scope-creep risk,
  and depends on cross-node decisions not yet made. Splitting into
  Stage 1–4 is the scope discipline.
- **Site the widget at `nodes/operator/app/src/components/`.**
  `dep-cruiser` blocks cross-node imports → Stages 2–4 from poly
  / future nodes can't import. Shared package now.
- **Keep `error_reports` table around for Stage 1 to dual-write.**
  Two stores for the same thing → drift by construction. Delete
  v0-of-v0 substrate atomically with Stage 1.

### Wire format — error → work-item

`buildWorkItemFromError(ctx, { userNote })` returns this for
`kind: "next-render"`:

```ts
{
  type: "bug",
  // 500-char hard cap on title (PR #1130 contract). Truncate the
  // assembled string, not just the message — handles long node
  // names + long error names.
  title: truncate(
    `[${ctx.node}] ${ctx.error.name || "Error"}: ${ctx.error.message}`,
    500
  ),
  summary: [
    `**Route:** \`${ctx.route}\``,
    `**Build SHA:** \`${buildSha}\``, // from NEXT_PUBLIC_APP_BUILD_SHA
    ctx.error.digest ? `**Digest:** \`${ctx.error.digest}\`` : null,
    userNote ? `\n**User note:**\n\n${userNote}` : null,
    ctx.error.stack
      ? `\n<details><summary>stack</summary>\n\n\`\`\`\n${truncate(ctx.error.stack, 8_000)}\n\`\`\`\n</details>`
      : null,
  ].filter(Boolean).join("\n\n"),
  outcome: "Investigate the error captured above. Fix the underlying cause; close this bug when verified on candidate-a.",
  status: "needs_triage",
  node: ctx.node,
  labels: ["error-report", "ux-feedback", `surface:${ctx.kind}`],
  priority: 2,
}
```

Loki line emitted server-side from operator's existing structured
log envelope at the work-items POST handler:

```
event="error_report.intake" workItemId="bug.5042" digest="..." build_sha="..." node="operator" userId="..."
```

### Invariants

- [ ] CONTRACTS_ARE_SOT — uses `WorkItemsCreateInput`; no new contract.
- [ ] OSS_OVER_BESPOKE — shadcn primitives only; no Sentry, no
      Feedback Fish, no third-party feedback lib.
- [ ] SHARED_PACKAGE_HOME — widget + hook + `ErrorContext` live in
      `packages/send-to-cogni/`. No `nodes/<x>/app/src/components/`
      home (boundary placement).
- [ ] SINGLE_SOURCE_OF_TRUTH — the `error_reports` table is dropped
      in this PR. v0-of-v0 substrate (button, route, contract,
      schema slice, contract test) deleted, no shim.
- [ ] AUTH_REQUIRED — inherits `/api/v1/work/items` auth (session
      OR Bearer). No new auth surface.
- [ ] DIGEST_IN_LOG — server-side log carries `digest` on intake.
- [ ] ZERO_NEW_DEPS — `package.json` diff for any consumer is
      "+`@cogni/send-to-cogni`" only; no third-party additions.
- [ ] ZERO_USER_COPY_PASTE — Sonner toast surfaces the `bug.5xxx`
      id with a click-through link to `/work/items/<id>`.
- [ ] ANON_HANDLED — `(public)/error.tsx` is **not** wired in
      Stage 1 (would 401). Stage 1 covers `(app)/error.tsx` only.
      Public flow tracked as a follow-up under the same task family.
- [ ] STAGE_1_SCOPE — only `(app)/error.tsx` is wired. No chat,
      no poly, no thumbs-down. Reviewers should reject anything
      that creeps beyond.

### Files

**Create — new shared package:**

- `packages/send-to-cogni/package.json` — `@cogni/send-to-cogni`,
  client-package shape (mirrors any existing client-only shared pkg
  in the repo; if none, mirror `packages/ids` pattern).
- `packages/send-to-cogni/tsconfig.json` + `tsup.config.ts`.
- `packages/send-to-cogni/src/index.ts` — barrel.
- `packages/send-to-cogni/src/error-context.ts` — `ErrorContext`
  union (Stage 1 has only `kind: "next-render"`; future kinds
  documented as TODO comments referencing Stages 2–4).
- `packages/send-to-cogni/src/build-work-item.ts` — pure
  `buildWorkItemFromError` function. Unit tests next to it.
- `packages/send-to-cogni/src/use-send-to-cogni.ts` — hook (build
  → POST `/api/v1/work/items` → toast).
- `packages/send-to-cogni/src/SendToCogniWidget.tsx` — client
  component. `variant: "page" | "popover"` (Stage 1 ships `page`;
  `popover` stub is fine if Stage 2 wants it immediately).
- `packages/send-to-cogni/AGENTS.md` — pointer doc; lists Stages
  2–4 as expected next surfaces.

**Modify:**

- `nodes/operator/app/src/app/(app)/error.tsx` — replace the
  task.0426 `<SendToCogniButton />` with `<SendToCogniWidget
variant="page" context={{ kind: "next-render", error, route, node: "operator" }} />`.
- `nodes/operator/app/package.json` — add
  `"@cogni/send-to-cogni": "workspace:*"`.
- `pnpm-workspace.yaml` if needed (probably not — `packages/*` is
  globbed).
- `docs/spec/observability.md` — replace the v0-of-v0 section with
  a 5-line section pointing to the work-items API + the staged plan
  table.

**Delete (same PR, no shim):**

- `nodes/operator/app/src/components/SendToCogniButton.tsx`.
- `nodes/operator/app/src/app/(public)/error.tsx` send-button
  embed (revert to pre-task.0426 shape — no widget for anon yet).
- `nodes/operator/app/src/app/api/v1/error-report/route.ts`.
- `packages/node-contracts/src/error-report.v1.contract.ts` (and
  its barrel re-export).
- `nodes/operator/app/tests/contract/error-report.v1.contract.test.ts`.
- `packages/db-schema/src/error-reports.ts` (and its barrel
  re-export).

**Schema cleanup:**

- New migration
  `nodes/operator/app/src/adapters/server/db/migrations/0029_drop_error_reports.sql`
  → `DROP TABLE IF EXISTS error_reports;`
- **Heads-up to implementer:** drizzle-kit will _also_ re-propose
  `DROP TABLE poly_copy_trade_*` (same drift that bit task.0426 /
  task.0322). Hand-prune the SQL to keep only the
  `error_reports` drop, exactly as task.0426 did.

**Keep:**

- `nodes/operator/app/src/app/(public)/dev/boom/page.tsx` — forced
  error route, the cheapest way to drive the loop.

## Plan

- [ ] **Pre-flight checks:**
  - [ ] task.0426 / PR #1121 merged (provides the v0-of-v0 substrate
        we delete).
  - [ ] PR #1130 (`POST /api/v1/work/items`) merged.
- [ ] Spin up worktree, bootstrap (`pnpm install --frozen-lockfile`).
- [ ] Create `packages/send-to-cogni/` skeleton, wire workspace.
- [ ] Implement `ErrorContext` (Stage 1 union only) +
      `buildWorkItemFromError` + unit test (input → expected
      `WorkItemsCreateInput`).
- [ ] Implement `useSendToCogni()` hook + `<SendToCogniWidget
    variant="page" />`.
- [ ] Wire `(app)/error.tsx` → widget; revert `(public)/error.tsx`
      to pre-task.0426 shape.
- [ ] Delete v0-of-v0 substrate + add drop migration. Hand-prune
      the SQL.
- [ ] Component test: render `variant="page"`, click submit, assert
      fetch body parses as `WorkItemsCreateInput` with the expected
      title/summary/labels.
- [ ] `pnpm check` green; PR.
- [ ] Flight to candidate-a; drive `/dev/boom` (signed in); confirm
      `bug.5xxx` row + Loki `error_report.intake` line at the
      deployed SHA.
- [ ] On merge: spawn task for Stage 2 (chat error bubble) — that
      task adds `ErrorContext.kind="chat"` + wires `ChatErrorBubble`.

## Validation

**Pre-merge:**

- Unit test for `buildWorkItemFromError({ kind: "next-render", ... })`
  covers: title-truncation at 500, digest-in-summary, stack
  truncation at 8KB, missing-stack handling.
- Component test renders `variant="page"`, simulates click, asserts
  fetch payload matches `WorkItemsCreateInput`.
- `pnpm check` green.

**On candidate-a (post-flight):**

- `exercise:` Sign in to operator on candidate-a. Hit `/dev/boom`.
  See `(app)/error.tsx` recovery card with the new widget. Type a
  one-liner. Click **Send to Cogni**. Capture the `bug.5xxx` id
  from the Sonner toast.
- `observability:`
  - `GET /api/v1/work/items?type=bug&node=operator` returns the
    new bug row.
  - Loki:
    `{namespace="cogni-candidate-a", pod=~"operator-node-app-.*"}
   | json | event="error_report.intake" | workItemId="bug.<id>"`
    returns ≥ 1 line at the deployed SHA.

`deploy_verified: true` only after the agent (or Derek) drives the
loop end-to-end on candidate-a and the Loki line + DB row both
land.

## Review Checklist

- [ ] **Work Item:** `task.0425` linked in PR body.
- [ ] **Stage discipline:** only `(app)/error.tsx` is wired. No
      chat, no poly, no thumbs-down sneaking in.
- [ ] **Shared package:** widget + hook in `packages/send-to-cogni/`,
      not in operator app code.
- [ ] **OSS_OVER_BESPOKE:** no third-party feedback dep; only
      `@cogni/send-to-cogni` workspace dep added.
- [ ] **No shim:** v0-of-v0 substrate fully deleted in this PR.
- [ ] **Drop migration:** hand-pruned (no
      `DROP poly_copy_trade_*`).
- [ ] **Tests:** unit test on `buildWorkItemFromError`; component
      test on widget submit.
- [ ] **Reviewer:** assigned and approved.

## PR / Links

-

## Attribution

- Story: derekg1729 (story.0417)
- Trigger: Derek's "is there not shadcn feedback components" + "lay
  this out in a staged implementation" pushback on PR #1121
- Substrate this collapses: task.0426 (v0-of-v0)
- Endpoint this leverages: PR #1130 / task.0423-doltgres
- Stages 2–4: spawned on demand after Stage 1 lands.
