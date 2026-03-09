---
id: bug.0059.handoff
type: handoff
work_item_id: bug.0059
status: active
created: 2026-02-14
updated: 2026-02-14
branch: fix/billing-issues
last_commit: 9c76eac0
---

# Handoff: Operator logs missing root cause in LiteLLM adapter

## Context

- When LiteLLM returns HTTP errors (4xx/5xx), the adapter logged only `statusCode` + `kind` — no response body, no provider error message. Comment in code said "no raw provider message."
- Operators diagnosing preview failures saw `{"kind":"provider_4xx"}` in Loki with zero actionable detail.
- Network errors (ECONNREFUSED, ENOTFOUND, timeouts) were thrown without any logging at the adapter boundary.
- This bug was the trigger for a broader "Error Envelope Standardization" track added to `proj.observability-hardening`.
- Renamed `langfuse-scrubbing.ts` → `content-scrubbing.ts` since `scrubStringContent()` is now shared beyond Langfuse (used by adapter error logging too).

## Current State

- **Done:** All 5 error paths in `litellm.adapter.ts` now log private root-cause diagnostics (redacted, bounded <=2KB). Commit `9c76eac0`.
- **Done:** Rename `langfuse-scrubbing.ts` → `content-scrubbing.ts`, all imports and doc refs updated.
- **Done:** `pnpm check` passes (lint, type, format, docs, arch).
- **Not done:** Unit tests for the new logging. Tests were started in `litellm.adapter.spec.ts` (a `describe("bug.0059: ...")` block was added with 5 test cases) but the `vi.mock("@/shared/observability")` setup needs verification — the mock was added at top level but tests haven't been run yet.
- **Not done:** The existing error test at line ~235 was updated to include `.text()` on the mock response but not run.

## Decisions Made

- **Private-only logging:** Response body excerpts go to operator logs only. `LlmError` thrown to callers is unchanged — no private details leak to API consumers.
- **Shared redaction:** Use `scrubStringContent()` from `@/shared/ai/content-scrubbing` (canonical string-level secret scrubber) instead of inlining regex patterns per adapter.
- **No stack test:** Stack tests use `FakeLlmService` (never touch real adapter). Unit tests with mocked fetch are the right level for this.
- **Error Envelope track:** P1/P2 roadmap items added to `proj.observability-hardening.md` for systematic error propagation (ErrorEnvelope type, GraphResult.errorDetail, route-layer structured responses).

## Next Actions

- [ ] Run unit tests: `pnpm test tests/unit/adapters/server/ai/litellm.adapter.spec.ts` — fix any mock issues
- [ ] Verify the `vi.mock("@/shared/observability")` doesn't break existing tests in the same file (they rely on logger being silenced)
- [ ] Manual verification: trigger a 404 in dev (bad model name), confirm Loki shows `responseExcerpt` with provider message
- [ ] Close bug.0059 after tests pass and manual verification
- [ ] Consider adding `errorDetail` assertion for SSE error path (stream tests not yet covered)

## Risks / Gotchas

- The `vi.mock("@/shared/observability")` replaces the real `makeLogger` for ALL tests in the file — existing tests that don't care about logging should still work since they don't assert on logger calls, but `vi.clearAllMocks()` in `beforeEach` must also clear `mockLoggerWarn`.
- `readErrorResponseExcerpt` calls `response.text()` — any mock `Response` in tests must include a `.text()` method or it will return `"[unreadable]"`.
- The `content-scrubbing.ts` rename touches a file considered API surface (`src/shared/ai/AGENTS.md` lists it). No external consumers, but downstream packages importing from old path would break.

## Pointers

| File / Resource                                           | Why it matters                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/adapters/server/ai/litellm.adapter.ts`               | The 5 fixed error paths — search for `responseExcerpt`, `rootCauseKind`, `errorDetail`      |
| `src/shared/ai/content-scrubbing.ts`                      | Shared redaction — `scrubStringContent()` used by adapter                                   |
| `tests/unit/adapters/server/ai/litellm.adapter.spec.ts`   | Unit tests — new `bug.0059` describe block + `mockLoggerWarn`                               |
| `work/items/bug.0059.operator-logs-missing-root-cause.md` | Work item with acceptance criteria                                                          |
| `work/projects/proj.observability-hardening.md`           | Error Envelope Standardization track (P0 done, P1/P2 roadmap)                               |
| `packages/ai-core/src/execution/error-codes.ts`           | `normalizeErrorToExecutionCode()` — collapses `provider_4xx` → `"internal"` (P1 fix target) |
| Commit `9c76eac0`                                         | The implementation commit                                                                   |
