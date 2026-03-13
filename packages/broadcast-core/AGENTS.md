# broadcast-core · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @cogni-dao
- **Status:** stable

## Purpose

Pure TypeScript types, port interfaces, error classes, and domain rules for the broadcasting pipeline. Defines contracts for content message lifecycle, platform publishing, and content optimization.

## Pointers

- [Broadcasting Spec](../../docs/spec/broadcasting.md): Broadcasting architecture and invariants

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

**External deps:** `zod` (payload schemas). Internal deps: `@cogni/ids`.

## Public Surface

- **Exports:**
  - `PublishPort` - Platform publishing interface (one impl per platform)
  - `ContentOptimizerPort` - AI content optimization interface
  - `BroadcastLedgerUserPort` - User-facing CRUD (RLS enforced)
  - `BroadcastLedgerWorkerPort` - Worker-facing persistence (BYPASSRLS)
  - Domain types: `ContentMessage`, `PlatformPost`, branded IDs
  - Enums: `PLATFORM_IDS`, `CONTENT_MESSAGE_STATUSES`, `PLATFORM_POST_STATUSES`, `REVIEW_DECISIONS`, `RISK_LEVELS`
  - Rules: `assessRisk()`, `canTransitionMessage()`, `canTransitionPlatformPost()`, `requiresReview()`
  - Error classes with type guards
- **Files considered API:** `index.ts`

## Ports

- **Uses ports:** none
- **Implements ports:** none (defines port interfaces)

## Responsibilities

- This directory **does**: Define port interfaces, domain types, error classes, and pure rule functions
- This directory **does not**: Make I/O calls directly or depend on any adapter code

## Standards

- Per `FORBIDDEN`: No `@/`, `src/`, `drizzle-orm`, or any I/O
- Per `ALLOWED`: Pure TypeScript types/interfaces only

## Dependencies

- **Internal:** `@cogni/ids` (branded ID types for port signatures)
- **External:** `zod` (payload schemas)

## Change Protocol

- Update this file when port interfaces or error types change
- Coordinate with broadcasting spec invariants

## Notes

- Package follows `@cogni/scheduler-core` pattern: pure types + ports, no I/O
- Branded IDs (`ContentMessageId`, `PlatformPostId`) use `Tagged` from type-fest
- State machine rules are pure functions — validated at adapter layer, not port interface
