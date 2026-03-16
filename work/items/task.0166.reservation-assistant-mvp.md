---
id: task.0166
type: task
title: Reservation Assistant MVP
status: needs_implement
priority: 1
rank: 1
estimate: 4
summary: Build a single-user personal reservation assistant that monitors hard-to-book restaurants via official platform alerts and assists with user-approved bookings.
outcome: Working prototype with DB schema, Temporal workflow, provider adapter interfaces, one Resy implementation, and CRUD API — all following existing hexagonal architecture patterns.
spec_refs:
assignees: claude
credit:
project:
branch: claude/reservation-assistant-mvp-Sy4le
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-16
updated: 2026-03-16
labels: [mvp, reservations]
external_refs:
---

# Reservation Assistant MVP

## Design

### Outcome

Enable a single user to create watch requests for hard-to-book restaurants, receive notifications when availability appears (via official platform alerts or manual ingestion), and optionally launch user-approved booking assistance through official channels.

### Approach

**Solution**: New `reservations` feature vertical following existing hexagonal patterns:

- 3 DB tables (`watch_requests`, `watch_events`, `booking_attempts`) in `packages/db-schema`
- Port interfaces for reservation CRUD and provider abstraction
- Temporal workflow: `ReservationWatchWorkflow` — create watch → wait for signal → notify user → optional booking assist
- Provider adapter interface with Resy stub implementation (official notify path)
- Contracts-first API for watch CRUD and event timeline
- Playwright booking assist behind explicit user approval gate

**Reuses**:

- `packages/db-schema` patterns (pgTable, enableRLS, timestamp conventions)
- `services/scheduler-worker` Temporal activity/workflow patterns
- Existing port/adapter/container DI wiring
- Existing contract-first API route pattern
- Pino logging, shared observability

**Rejected**:

- **Scraping/polling approach**: Violates platform TOS; replaced by official alert ingestion + manual webhook/email paths
- **AI agent orchestration**: Over-engineered for MVP; deterministic state machine via Temporal is simpler and auditable
- **Separate microservice**: Unnecessary complexity; fits within existing scheduler-worker + web app architecture
- **Generic multi-user platform**: Scope creep; single-user MVP validates the flow first

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_SCRAPING: Never scrape protected endpoints, bypass anti-bot, rotate accounts, or evade detection
- [ ] USER_APPROVAL_GATE: Booking assist only launches after explicit user approval signal
- [ ] OFFICIAL_CHANNELS_ONLY: All platform interactions go through official UX/API paths
- [ ] TERMS_COMPLIANT: Playwright usage limited to user-authorized, terms-compliant browser assistance with stored authenticated session
- [ ] AUDIT_TRAIL: Every state transition logged in `watch_events` with source attribution
- [ ] DETERMINISTIC_FLOW: Temporal workflow is pure orchestration; all I/O in activities
- [ ] CONTRACT_FIRST: All API shapes defined in contracts using Zod
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal layering (spec: architecture)
- [ ] SIMPLE_SOLUTION: Leverages existing patterns/OSS over bespoke code

### Files

<!-- High-level scope -->

- Create: `packages/db-schema/src/reservations.ts` — 3 tables (watch_requests, watch_events, booking_attempts)
- Modify: `packages/db-schema/src/index.ts` — re-export reservations schema
- Modify: `packages/db-schema/package.json` — add reservations export
- Create: `apps/web/src/ports/reservation.port.ts` — ReservationServicePort, ReservationProviderPort
- Modify: `apps/web/src/ports/index.ts` — re-export reservation ports
- Create: `apps/web/src/contracts/reservations.watch.v1.contract.ts` — watch CRUD contracts
- Create: `apps/web/src/contracts/reservations.events.v1.contract.ts` — event timeline contract
- Create: `apps/web/src/contracts/reservations.booking.v1.contract.ts` — booking attempt contract
- Create: `apps/web/src/core/reservations/` — domain types, status enums, validation rules
- Create: `apps/web/src/features/reservations/services/` — watch-manager, booking-assist orchestration
- Create: `apps/web/src/adapters/server/reservations/` — Drizzle adapter, Resy provider stub
- Modify: `apps/web/src/bootstrap/container.ts` — wire reservation adapters
- Create: `apps/web/src/app/api/v1/reservations/` — API routes
- Create: `services/scheduler-worker/src/workflows/reservation-watch.workflow.ts` — Temporal workflow
- Create: `services/scheduler-worker/src/activities/reservation.ts` — activities for notification + booking
- Create: `docs/guides/reservation-assistant.md` — local dev instructions + risk notes

## Requirements

- 3 DB tables: `watch_requests`, `watch_events`, `booking_attempts` with proper schema
- Provider adapter interface supporting Resy and OpenTable alert paths
- Resy provider implementation (official notify integration path)
- Notification ingestion from email/webhook/manual link
- Temporal workflow: create → wait for signal → notify → optional booking assist
- Booking assist uses Playwright only for user-approved, terms-compliant actions
- API endpoints: create watch, pause/cancel watch, show event timeline, show attempts
- Compliance guardrails enforced at every layer
- Audit trail via `watch_events` table

## Allowed Changes

- `packages/db-schema/src/` — new schema file + barrel update
- `apps/web/src/ports/` — new port file + barrel update
- `apps/web/src/contracts/` — new contract files
- `apps/web/src/core/reservations/` — new domain module
- `apps/web/src/features/reservations/` — new feature vertical
- `apps/web/src/adapters/server/reservations/` — new adapter directory
- `apps/web/src/bootstrap/container.ts` — DI wiring
- `apps/web/src/app/api/v1/reservations/` — new API routes
- `services/scheduler-worker/src/` — new workflow + activities
- `docs/guides/` — dev instructions doc

## Plan

- [x] Design (this document)
- [ ] Create DB schema (`packages/db-schema/src/reservations.ts`)
- [ ] Create core domain types (`apps/web/src/core/reservations/`)
- [ ] Create port interfaces (`apps/web/src/ports/reservation.port.ts`)
- [ ] Create API contracts (`apps/web/src/contracts/reservations.*.contract.ts`)
- [ ] Create feature services (`apps/web/src/features/reservations/services/`)
- [ ] Create adapters (Drizzle + Resy provider) (`apps/web/src/adapters/server/reservations/`)
- [ ] Wire DI container (`apps/web/src/bootstrap/container.ts`)
- [ ] Create API routes (`apps/web/src/app/api/v1/reservations/`)
- [ ] Create Temporal workflow + activities
- [ ] Add compliance guardrails doc
- [ ] Validate with `pnpm check`

## Validation

**Command:**

```bash
pnpm typecheck && pnpm lint && pnpm format --check
```

**Expected:** All pass with no errors.

## Review Checklist

- [ ] **Work Item:** `task.0166` linked in PR body
- [ ] **Spec:** all invariants upheld (NO_SCRAPING, USER_APPROVAL_GATE, OFFICIAL_CHANNELS_ONLY)
- [ ] **Tests:** contract tests cover API shapes
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- claude (design + implementation)
