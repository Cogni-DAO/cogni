---
id: task.0158
type: task
title: "Wire WorkItemQueryPort into UI — contracts, API routes, React Query dashboard"
status: done
priority: 0
rank: 6
estimate: 3
summary: "Replace the hand-rolled work-scanner.ts with WorkItemQueryPort from @cogni/work-items. Wire MarkdownWorkItemAdapter into the DI container, create list/get contracts and API routes, and update the /work dashboard to use React Query."
outcome: "The /work dashboard renders work items fetched via GET /api/v1/work/items (backed by WorkItemQueryPort). GET /api/v1/work/items/[id] returns a single item. The old work-scanner.ts is deleted. API is available for MCP and agent consumers."
spec_refs: [work-items-port, architecture-spec]
assignees: []
credit:
project: proj.agentic-project-management
branch: feat/work-items-ui-read-path
pr: https://github.com/Cogni-DAO/node-template/pull/555
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-11
updated: 2026-03-24
labels: [work-system, ui, api]
external_refs:
---

# Wire WorkItemQueryPort into UI — contracts, API routes, React Query dashboard

## Design

### Outcome

The `/work` dashboard reads work items through the `WorkItemQueryPort` via a proper contract → facade → route → React Query stack, replacing the ad-hoc filesystem scanner. The API is consumable by MCP tools and agents.

### Approach

**Solution**: Follow the established contract → facade → route → client fetch → React Query pattern (identical to schedules feature). Wire `MarkdownWorkItemAdapter` into the DI container. Create two read-only API endpoints.

**Reuses**:

- `@cogni/work-items` package (`WorkItemQueryPort`, `MarkdownWorkItemAdapter`, domain types)
- `wrapRouteHandlerWithLogging` from `@/bootstrap/http`
- React Query pattern from schedules feature (`useQuery` + typed fetch wrapper)
- Existing `WorkDashboardView` UI (preserve current filtering/sorting/display)

**Rejected**:

- **SSR-only (no API route)**: Would work for the dashboard but provides no API for MCP/agents. Breaks the contract-first pattern.
- **Keep work-scanner.ts alongside port**: Two code paths reading the same data. Maintenance burden, consistency risk.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CONTRACTS_ARE_TRUTH: All request/response shapes defined in `src/contracts/work.items.*.v1.contract.ts` using Zod. No manual type declarations.
- [ ] HEXAGONAL_LAYERS: `app → features → ports → core`. Route imports contract + facade only. Facade resolves port from container.
- [ ] VALIDATE_IO: Route validates output with `contract.output.parse()` before responding.
- [ ] PORT_VIA_CONTAINER: `MarkdownWorkItemAdapter` instantiated in `bootstrap/container.ts`, not in route/facade.
- [ ] SCANNER_DELETED: `src/lib/work-scanner.ts` removed. No duplicate read path.
- [ ] SIMPLE_SOLUTION: Leverages existing patterns/OSS over bespoke code.
- [ ] ARCHITECTURE_ALIGNMENT: Follows established contract → facade → route → React Query pattern (spec: architecture).

### Files

<!-- High-level scope -->

#### Create

- `src/contracts/work.items.list.v1.contract.ts` — List operation contract (Zod input: query filters, output: items array)
- `src/contracts/work.items.get.v1.contract.ts` — Get operation contract (Zod output: single work item)
- `src/app/_facades/work/items.server.ts` — Facade: resolves port from container, calls `list()` / `get()`
- `src/app/api/v1/work/items/route.ts` — `GET /api/v1/work/items` (list with query params)
- `src/app/api/v1/work/items/[id]/route.ts` — `GET /api/v1/work/items/:id` (get by ID)
- `src/app/(app)/work/_api/fetchWorkItems.ts` — Typed fetch wrapper for React Query

#### Modify

- `src/bootstrap/container.ts` — Add `workItemQuery: WorkItemQueryPort` wired to `MarkdownWorkItemAdapter`
- `src/app/(app)/work/page.tsx` — Remove `getWorkItems()` call, render `<WorkDashboardView />` (no props)
- `src/app/(app)/work/view.tsx` — Switch from props to `useQuery` + fetch wrapper. Keep all existing filtering/sorting/display.

#### Delete

- `src/lib/work-scanner.ts` — Replaced by port

#### Test

- `tests/unit/contracts/work.items.list.v1.test.ts` — Contract schema validation
- `tests/unit/facades/work-items.test.ts` — Facade unit test with mocked port

### Implementation Notes

**Contract shape**: The list contract output maps `WorkItem` (package type) to a JSON-safe DTO. Key mappings:

- `SubjectRef[]` → serialized as-is (already plain objects)
- `ExternalRef[]` → serialized as-is
- `WorkItemId` (branded string) → plain string in JSON
- Dates already ISO strings in the package type

**Query params**: The list endpoint accepts optional query parameters matching `WorkQuery`:

- `?types=task,bug` — filter by type
- `?statuses=needs_implement,needs_design` — filter by status
- `?text=search+term` — full-text search
- `?projectId=proj.agentic-project-management` — filter by project
- `?limit=50` — pagination limit

**Container wiring**: `MarkdownWorkItemAdapter` needs `workDir` (the repo root). Use `process.cwd()` which is already the pattern for the existing scanner.

**Auth**: Routes use `auth: { mode: "required" }` — work items are visible to all authenticated users.

**No feature service layer**: The read path is a pure pass-through (query port → DTO). A feature service would add no value. Facade calls port directly, matching the profile/users pattern.

## Review Feedback (revision 1)

### Blocking

1. **Missing tests** — Design promised contract schema tests and facade unit tests. Create:
   - `apps/operator/tests/unit/contracts/work.items.list.v1.test.ts` — validate schema accepts valid DTO and rejects invalid
   - `apps/operator/tests/unit/facades/work-items.test.ts` — mock `WorkItemQueryPort`, verify `listWorkItems()` and `getWorkItem()` map correctly

2. **AGENTS.md not updated** — Per change protocol:
   - `apps/operator/src/contracts/AGENTS.md` Public Surface: add `work.items.list.v1`, `work.items.get.v1`
   - `apps/operator/src/app/api/AGENTS.md` Routes: add `GET /api/v1/work/items`, `GET /api/v1/work/items/[id]`

## Validation

- [ ] `GET /api/v1/work/items` returns work items matching the port's `list()` output
- [ ] `GET /api/v1/work/items?types=task&statuses=needs_implement` filters correctly
- [ ] `GET /api/v1/work/items/task.0155` returns a single work item
- [ ] `GET /api/v1/work/items/nonexistent` returns 404
- [ ] `/work` dashboard renders identically to current (same data, same filters, same sorting)
- [ ] `src/lib/work-scanner.ts` is deleted, no remaining imports
- [ ] `pnpm check` passes
- [ ] Contract schema tests pass
