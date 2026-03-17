---
id: reservation-assistant-guide
type: guide
title: Reservation Assistant — Local Dev & Compliance Guide
status: draft
trust: draft
summary: Local development instructions, API usage, compliance guardrails, and risk notes for the reservation assistant MVP.
read_when: Working on the reservation assistant feature or reviewing compliance.
owner: claude
created: 2026-03-16
---

# Reservation Assistant — Local Dev & Compliance Guide

> Work item: task.0166 | Branch: claude/reservation-assistant-mvp-Sy4le

## Overview

Personal reservation assistant MVP for a single user. Monitors hard-to-book restaurants via official platform alerts and provides user-approved booking assistance through official channels.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ API Routes (/api/v1/reservations/*)                     │
│   watches/ — CRUD for watch requests                    │
│   ingest/  — receive availability notifications         │
│   watches/[id]/events/   — event timeline               │
│   watches/[id]/bookings/ — booking attempts              │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│ Feature Service (watch-manager.ts)                       │
│   createWatch → validate → store → setup provider alert │
│   ingestAlert → store event → (signal Temporal workflow) │
│   approveBooking → store → delegate to provider          │
└──────────────┬──────────────────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼──────┐  ┌──────▼──────┐
│ Store Port  │  │ Provider    │
│ (Drizzle)   │  │ Port        │
│             │  │ (Resy stub) │
└─────────────┘  └─────────────┘
```

### Temporal Workflow (scheduler-worker)

```
ReservationWatchWorkflow
  1. Setup alert → record "created" event
  2. Wait for alertReceived signal (up to 30 days)
  3. On alert → notify user, wait for approval (up to 1 hour)
  4. On approval → launch booking assist via provider
  5. Record all outcomes as watch_events
```

Signals: `alertReceived`, `userApproved`, `userDeclined`, `cancelWatch`

## Database Tables

| Table              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `watch_requests`   | User-created monitoring entries for venue+date+party |
| `watch_events`     | Immutable audit trail (append-only)                  |
| `booking_attempts` | Records of user-approved booking assistance          |

## Local Development

### Prerequisites

- Running Postgres (via `pnpm dev:stack` or `pnpm docker:dev:stack`)
- Temporal server (included in dev stack)

### Quick Start

```bash
# 1. Start infrastructure
pnpm dev:stack

# 2. Run migrations (creates reservation tables)
pnpm db:migrate

# 3. Start dev server
pnpm dev
```

### API Endpoints

```bash
# Create a watch request
curl -X POST http://localhost:3000/api/v1/reservations/watches \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "resy",
    "venue": "Carbone",
    "partySize": "2",
    "dateStart": "2026-04-01T00:00:00Z",
    "dateEnd": "2026-04-30T00:00:00Z",
    "preferredTimeStart": "19:00",
    "preferredTimeEnd": "21:00"
  }'

# List watches
curl http://localhost:3000/api/v1/reservations/watches

# Ingest an availability alert (from email forwarding, webhook, etc.)
curl -X POST http://localhost:3000/api/v1/reservations/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "watchRequestId": "<uuid>",
    "source": "manual",
    "payload": {"message": "Table available at 7:30 PM on April 15"}
  }'

# View event timeline
curl http://localhost:3000/api/v1/reservations/watches/<id>/events

# Approve booking (USER_APPROVAL_GATE)
curl -X POST http://localhost:3000/api/v1/reservations/watches/<id>/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "sessionStatePath": "/path/to/browser-session.json",
    "targetSlot": {"date": "2026-04-15", "time": "19:30"}
  }'

# List booking attempts
curl http://localhost:3000/api/v1/reservations/watches/<id>/bookings

# Pause/cancel a watch
curl -X PATCH http://localhost:3000/api/v1/reservations/watches/<id>/status \
  -H "Content-Type: application/json" \
  -d '{"status": "paused"}'
```

## Compliance Guardrails

### Hard Rules (MUST NOT violate)

| Rule                       | Description                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- |
| **NO_SCRAPING**            | Never scrape protected endpoints, bypass anti-bot systems, or rotate accounts           |
| **USER_APPROVAL_GATE**     | Booking assist ONLY launches after explicit user approval via POST to bookings endpoint |
| **OFFICIAL_CHANNELS_ONLY** | All platform interactions go through official UX/API paths                              |
| **TERMS_COMPLIANT**        | Playwright usage limited to user-authorized, terms-compliant browser assistance         |
| **AUDIT_TRAIL**            | Every state transition logged in `watch_events` with source attribution                 |
| **NO_AUTO_PURCHASE**       | System never auto-purchases or sells reservations                                       |
| **NO_DETECTION_EVASION**   | No proxy rotation, user-agent spoofing, or fingerprint evasion                          |

### Alert Ingestion — What IS Allowed

- User forwards email notifications manually
- User sets up email-to-webhook forwarding (e.g., Zapier/Make)
- Platform sends webhook callbacks through official developer APIs
- User pastes availability links manually via the ingest endpoint
- User sets up Resy/OpenTable native notifications and manually triggers ingest

### Alert Ingestion — What is NOT Allowed

- Polling platform APIs on a timer
- Scraping availability pages
- Accessing undocumented/internal APIs
- Using headless browsers to monitor pages
- Any form of automated detection evasion

### Booking Assist — What IS Allowed (after user approval)

- Opening the official platform booking page in a Playwright browser
- Using the user's own stored, authenticated session state
- Navigating the standard booking flow (select time → confirm → submit)
- Capturing screenshots for audit trail
- Single attempt per approval (no retry storms)

### Booking Assist — What is NOT Allowed

- Creating new accounts or sessions
- Bypassing CAPTCHAs or verification challenges
- Submitting forms faster than human speed
- Multiple concurrent booking attempts
- Any action the user hasn't explicitly approved

## Risk Notes

1. **Platform TOS**: Even terms-compliant browser automation may violate specific platform terms. The MVP stubs out Playwright booking to defer this risk. Full implementation requires legal review of each platform's TOS.

2. **Session State Security**: Stored browser session state files contain authentication cookies. These must be encrypted at rest and access-controlled. MVP assumes local filesystem; production needs encrypted storage.

3. **Rate Limiting**: The ingest endpoint should be rate-limited to prevent abuse. Current MVP relies on authentication but has no per-user rate limits.

4. **Single User**: This MVP is designed for a single user. Multi-user support requires:
   - Per-user session state isolation
   - Rate limiting per user per platform
   - Billing/credit gating

5. **Temporal Workflow Lifetime**: Watch workflows can run up to 30 days. Ensure Temporal server retention is configured appropriately.

## File Map

| Path                                                                    | Purpose                            |
| ----------------------------------------------------------------------- | ---------------------------------- |
| `packages/db-schema/src/reservations.ts`                                | Database schema (3 tables)         |
| `apps/web/src/core/reservations/`                                       | Domain types, rules, validation    |
| `apps/web/src/ports/reservation.port.ts`                                | Port interfaces (store + provider) |
| `apps/web/src/contracts/reservations.*.contract.ts`                     | API contracts (Zod schemas)        |
| `apps/web/src/features/reservations/services/`                          | Feature service orchestration      |
| `apps/web/src/adapters/server/reservations/`                            | Drizzle store + Resy provider      |
| `apps/web/src/app/api/v1/reservations/`                                 | API routes                         |
| `services/scheduler-worker/src/workflows/reservation-watch.workflow.ts` | Temporal workflow                  |
| `services/scheduler-worker/src/activities/reservation.ts`               | Temporal activities                |
