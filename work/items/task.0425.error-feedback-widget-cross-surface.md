---
id: task.0425
type: task
title: "Send-to-Cogni: shadcn-composed widget that posts a bug work item via the Doltgres work-items API"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "Replace the v0-of-v0 substrate (custom `error_reports` table + custom `/api/v1/error-report` route + bespoke `<SendToCogniButton />`) with a shadcn-composed `<SendToCogniWidget />` (Popover + Form + Sonner — zero new deps) that POSTs a `bug.*` work item to `POST /api/v1/work/items` (the Doltgres-backed endpoint shipping in PR #1130 / task.0423-doltgres). Same UX, drastically less infra: no bespoke storage, no bespoke contract, no bespoke route. Wires into `(app)/error.tsx`, `(public)/error.tsx`, `ChatErrorBubble` (operator chat), and the poly close-order error UI."
outcome: "A user hitting any error surface (route boundary, chat error bubble, poly trade close-order failure) clicks 'Send to Cogni', writes a one-liner, and sees a Sonner toast with the work-item id (e.g. `bug.5042`). That row is queryable via the unified `/api/v1/work/items` API, has a `dolt_commit` audit, and gets picked up by operator's existing triage flow. Zero new tables, zero new routes, zero new third-party deps. Per-surface bespoke report buttons are explicitly out."
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
labels: [frontend, ux, observability, error-handling, oss-first]
external_refs:
  - work/items/task.0426.send-to-cogni-error-intake-v0.md
  - work/items/story.0417.ui-send-to-cogni-error-button.md
  - https://github.com/Cogni-DAO/node-template/pull/1130
  - nodes/operator/app/src/features/ai/components/ChatErrorBubble.tsx
---

# Send-to-Cogni: shadcn widget + Doltgres work-items API

## Problem

`task.0426` (formerly task.0423-send-to-cogni-v0-of-v0, PR #1121)
shipped:

- a bespoke `error_reports` Postgres table,
- a bespoke `/api/v1/error-report` route,
- a bespoke `<SendToCogniButton />` (custom CSS, full-page only),
- and a deliberate "task.0420 Temporal worker fills loki_window later"
  punt.

In parallel, [PR #1130](https://github.com/Cogni-DAO/node-template/pull/1130)
ships **`POST /api/v1/work/items`** — a Doltgres-backed,
auth-required, `dolt_commit`-audited endpoint for creating any
work-item type, including `bug`. That's exactly the system "an
agent files a bug from a UI error" should write to.

Combined with the fact that **shadcn primitives already in operator
(`Popover`, `Form`, `Textarea`, `Button`, `Sonner`) compose into a
1-click feedback widget without a single new dependency**, the v0-of-v0
substrate is now strictly worse than what's available. This task
collapses it.

## Design

### Outcome

Any user hitting an error surface — route boundary, chat error
bubble, or a poly trade close-order failure — clicks one button,
optionally types a sentence, and sees a Sonner toast confirming a
new `bug.*` work item is filed and the operator will pick it up.
Zero copy-paste from the user. Same widget on every surface, same
work-item shape, no bespoke storage.

### Approach

**Solution**: a single shadcn-composed `<SendToCogniWidget />`
(client component) with a `variant` prop:

| Variant   | Use                              | Trigger                       | Surface           |
| --------- | -------------------------------- | ----------------------------- | ----------------- |
| `page`    | `error.tsx` route boundaries     | inline "Send to Cogni" button | full-page         |
| `inline`  | `ChatErrorBubble`, form errors   | small button next to error    | inline next to UI |
| `popover` | poly trade error toast, anywhere | icon button → Popover         | floating          |

All three variants share one `useSendToCogni({ error, route, node })`
hook that:

1. Builds the work-item payload (see "Wire format" below).
2. POSTs to `/api/v1/work/items` (PR #1130 endpoint).
3. Renders a Sonner toast on success / inline error on fail.

**Reuses (zero new deps):**

- `Popover`, `Form`, `Textarea`, `Button`, `Sonner` — all already in
  operator's shadcn install.
- `POST /api/v1/work/items` — PR #1130's endpoint. Auth resolved by
  the unified `getSessionUser` (Bearer or session). Server allocates
  id ≥ 5000.
- `WorkItemsCreateInput` Zod schema from `@cogni/node-contracts`
  (PR #1130) — single source of truth for the wire format.
- Pino structured logging — keep emitting the
  `event="error_report.intake"` line (carries `digest` + `route` +
  `build_sha` + `userId`) so an agent can still grep Loki for the
  full error context the work-item title can't carry.
- Existing `ChatErrorBubble`, both `error.tsx` files, poly trade
  error UI — drop the widget in, no rewrites.

**Rejected alternatives:**

- **Sentry User Feedback widget.** Drop-in nice, but ties the
  data plane to Sentry's hosted backend (or self-hosted GlitchTip,
  which is its own infra project). Cogni's storage is Doltgres
  work-items; bridging back would require a Sentry-→work-item
  bridge. Cleanest cut: skip the third party.
- **Feedback Fish / FeedbackFin / similar.** Same problem: hosted
  backend, doesn't write into our work-items system, requires
  a bridge.
- **Build our own headless `<ErrorReport>` compound component
  family.** Premature abstraction. shadcn primitives
  - one wrapper component covers all three v1 variants in <100 LOC.
- **Keep `error_reports` as a separate fire-and-forget log** while
  also creating a work item. Two stores for the same thing — drift
  by construction. Pino → Loki is the existing fire-and-forget path
  and already covers the structured-log angle.
- **Add a new route** like `/api/v1/error-report → bug-creator`
  proxy. Pure indirection; the UI can post directly to
  `/api/v1/work/items` with the same auth.

### Wire format — error → work-item shape

The widget builds this from the captured error + user note:

```ts
WorkItemsCreateInput = {
  type: "bug",
  title: `[${node}] ${errorName}: ${truncate(errorMessage, 200)}`,
  summary: [
    `**Route:** \`${route}\``,
    `**Build SHA:** \`${buildSha}\``,
    digest ? `**Digest:** \`${digest}\`` : null,
    userNote ? `\n**User note:**\n\n${userNote}` : null,
    errorStack ? `\n<details><summary>stack</summary>\n\n\`\`\`\n${truncate(errorStack, 8_000)}\n\`\`\`\n</details>` : null,
    componentStack ? `\n<details><summary>componentStack</summary>\n\n\`\`\`\n${truncate(componentStack, 4_000)}\n\`\`\`\n</details>` : null,
  ].filter(Boolean).join("\n\n"),
  outcome: "Investigate the error captured above. Fix the underlying cause; close this bug when verified on candidate-a.",
  status: "needs_triage",
  node: <node>,
  labels: ["error-report", "ux-feedback"],
  priority: 2,
};
```

Loki line stays — emitted server-side from a small wrapper around
the work-items create handler (or kept in operator's existing log
envelope), so agents can correlate by `digest`/`workItemId` for the
deeper stack:

```
event="error_report.intake" workItemId="bug.5042" digest="..." build_sha="..." node="operator" userId="..."
```

### Invariants

- [ ] CONTRACTS_ARE_SOT — uses `WorkItemsCreateInput` from
      `@cogni/node-contracts`; no new contract introduced.
- [ ] OSS_OVER_BESPOKE — no Sentry dep, no Feedback Fish dep, no
      bespoke widget lib. shadcn primitives only.
- [ ] SINGLE_SOURCE_OF_TRUTH — error reports live in Doltgres
      `work_items` (one place), not split across `error_reports` +
      `work_items`. v0-of-v0 substrate is deleted.
- [ ] AUTH_REQUIRED — inherits `/api/v1/work/items` auth (session
      OR Bearer key). No new auth surface.
- [ ] DIGEST_IN_LOG — the structured Pino line on submit carries
      `digest` so an agent can grep Loki for the original failing
      log line. Title/summary alone are not the audit trail.
- [ ] ZERO_NEW_DEPS — `package.json` unchanged. (`pnpm install
  --frozen-lockfile` is a no-op for this PR.)
- [ ] ZERO_USER_COPY_PASTE — clicking the widget produces a
      tracking link in a Sonner toast; user never has to copy a
      UUID anywhere.

### Files

**Create:**

- `nodes/operator/app/src/components/send-to-cogni/SendToCogniWidget.tsx`
  — the shadcn-composed widget. Three variants via `variant` prop;
  one default export.
- `nodes/operator/app/src/components/send-to-cogni/use-send-to-cogni.ts`
  — the submission hook (build payload → POST → toast). ~50 LOC.
- `nodes/operator/app/src/components/send-to-cogni/AGENTS.md` —
  short pointer doc.
- Component test for each variant, mocking `fetch` to assert the
  payload shape matches `WorkItemsCreateInput`.

**Modify:**

- `nodes/operator/app/src/app/(app)/error.tsx` — replace
  `<SendToCogniButton />` with `<SendToCogniWidget variant="page" />`.
- `nodes/operator/app/src/app/(public)/error.tsx` — same.
- `nodes/operator/app/src/features/ai/components/ChatErrorBubble.tsx`
  — render `<SendToCogniWidget variant="inline" error={chatError} />`
  alongside the existing reset action.
- `nodes/poly/app/src/...` (poly close-order error path — exact
  file determined during /implement; surveyed quickly: probably
  `nodes/poly/app/src/features/trade/...` or wherever the
  close-order toast lives) — render
  `<SendToCogniWidget variant="popover" />` next to the error toast
  action.

**Delete (with the same PR — no shim):**

- `nodes/operator/app/src/components/SendToCogniButton.tsx` (v0-of-v0).
- `nodes/operator/app/src/app/api/v1/error-report/route.ts` (v0-of-v0).
- `packages/node-contracts/src/error-report.v1.contract.ts` (v0-of-v0).
- `nodes/operator/app/tests/contract/error-report.v1.contract.test.ts`
  (v0-of-v0).

**Schema cleanup (drop bespoke table):**

- New migration
  `nodes/operator/app/src/adapters/server/db/migrations/0029_drop_error_reports.sql`
  → `DROP TABLE IF EXISTS error_reports;`
- Remove `packages/db-schema/src/error-reports.ts` and its barrel
  re-export.
- Remove the spec section in `docs/spec/observability.md` that
  documented the v0-of-v0 substrate; replace with a 5-line section
  pointing to the work-items API.

**Keep (still useful):**

- `nodes/operator/app/src/app/(public)/dev/boom/page.tsx` — the
  forced-error route is the cheapest way to drive the loop on
  candidate-a. Stays.

## Plan

- [ ] **Land task.0426 (PR #1121) first** so the v0-of-v0 substrate
      exists in main, then this task deletes it cleanly. (Alt:
      Derek can choose to close PR #1121 unmerged and let this PR
      ship the whole story; either is fine.)
- [ ] Confirm PR #1130 (Doltgres work-items API) is merged.
- [ ] Build `<SendToCogniWidget />` + `useSendToCogni` hook.
- [ ] Wire all four surfaces. Delete v0-of-v0 substrate. Add drop
      migration.
- [ ] Component tests per variant; assert payload shape matches
      `WorkItemsCreateInput`.
- [ ] Flight to candidate-a; drive `/dev/boom` + chat error + poly
      trade close-fail; confirm three new `bug.5xxx` work items
      land in Doltgres + three Loki lines.

## Validation

**Pre-merge:**

- Component tests render all three variants; clicking the submit
  button triggers a fetch with a body that parses as
  `WorkItemsCreateInput` (no extra fields, no missing required
  fields). All variants produce identical payload shapes.
- `pnpm check` green.

**On candidate-a (post-flight):**

- `exercise:` Drive three surfaces:
  1. `/dev/boom` (full-page; the v0-of-v0 dev route).
  2. Operator chat: send a request that triggers an `ai.tool_call`
     failure (use a known-bad model ref or graph name).
  3. Poly trading: attempt to close a non-existent / already-closed
     order.
- After each, click "Send to Cogni" → confirm Sonner toast shows a
  `bug.5xxx` id.
- `observability:`
  - `GET /api/v1/work/items?type=bug&node=operator,poly` returns
    the three new rows at the deployed SHA.
  - Loki:
    `{node=~"operator|poly"} | json | event="error_report.intake"`
    returns three lines, one per submission, each tagged with the
    work-item id.

`deploy_verified: true` only after all three surfaces produce
a `bug.5xxx` row + Loki line on candidate-a, all driven by the
agent (or Derek with zero copy-paste).

## Review Checklist

- [ ] **Work Item:** `task.0425` linked in PR body
- [ ] **OSS_OVER_BESPOKE:** package.json unchanged; no new deps
- [ ] **SINGLE_SOURCE_OF_TRUTH:** `error_reports` table dropped;
      drop migration present
- [ ] **No shim:** v0-of-v0 substrate (button, route, contract,
      schema slice, test) deleted in the same PR — not deprecated,
      not aliased
- [ ] **Tests:** component tests per variant assert payload shape
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- Story: derekg1729 (story.0417)
- Trigger: Derek's "what's the point... is there not shadcn feedback
  components" pushback on PR #1121
- Substrate this collapses: task.0426 (v0-of-v0)
- Endpoint this leverages: PR #1130 / task.0423-doltgres
