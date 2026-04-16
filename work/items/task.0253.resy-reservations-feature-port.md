---
id: task.0253
type: task
title: "Port resy reservations feature from cogni-resy-helper fork"
status: needs_design
priority: 1
rank: 2
estimate: 3
summary: "Port the full reservations vertical feature from cogni-resy-helper/apps/web into nodes/resy/app. Requires core domain (models, validation, state machine), ports, adapters, contracts, routes, and UI."
outcome: "Resy node has working reservations feature: watch requests, booking flow, event ingestion, status tracking."
spec_refs: []
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [resy, nodes, feature-port]
external_refs:
  - repo: Cogni-DAO/cogni-resy-helper
    branch: staging
---

## Context

The resy node was built from the operator template but the reservations
feature was not properly ported. The feature spans the full hex architecture:

**Source:** `cogni-resy-helper/apps/web/src/`

## Files to Port (from fork)

### Core domain (`core/reservations/`)

- `model.ts` — WatchRequest entity, status enum, state machine
- `rules.ts` — assertValidDateRange, assertValidPartySize, isValidStatusTransition
- `errors.ts` — InvalidStatusTransitionError
- `public.ts` — barrel exports
- Update `core/public.ts` to re-export reservations

### Ports (`ports/`)

- `reservation.port.ts` — ReservationProviderPort interface
- `graph-executor.port.ts` — if resy-specific

### Adapters (`adapters/server/reservations/`)

- Full adapter implementation from fork

### Contracts (`contracts/`)

- `reservations.booking.v1.contract.ts`
- `reservations.events.v1.contract.ts`
- `reservations.ingest.v1.contract.ts`
- `reservations.watch.v1.contract.ts`

### Features (`features/reservations/`)

- Full feature slice from fork

### Routes

- `app/(app)/reservations/` — pages
- `app/api/v1/reservations/` — API routes

### Bootstrap

- Wire reservations capability in container.ts

## Validation

- [ ] Resy node boots with no import errors
- [ ] Reservations API routes respond
- [ ] Sidebar shows Reservations link
- [ ] `pnpm typecheck:resy` passes
