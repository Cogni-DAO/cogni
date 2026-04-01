# src/shared/auth · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable

## Purpose

Shared authentication types and primitives used across app layer and adapters. Provides TypeScript types for NextAuth session data, and the AsyncLocalStorage primitive for link-intent propagation with discriminated union (pending vs failed intents). Pure types + AsyncLocalStorage; no DB, no React, no Next APIs.

## Pointers

- [Root auth module](../../auth.ts)
- [Security & Auth Spec](../../../../../docs/spec/security-auth.md)
- [session.ts](./session.ts) - Session type definitions

## Boundaries

```json
{
  "layer": "shared",
  "may_import": ["shared"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters/server",
    "adapters/worker",
    "adapters/cli",
    "mcp"
  ]
}
```

## Public Surface

- **Exports:**
  - `SessionUser` - User identity type with id (DB UUID) and walletAddress (`string | null` — null for OAuth-only users)
  - `LinkIntent` - Discriminated union: `PendingLinkIntent` (txId + userId) or `FailedLinkIntent` (reason)
  - `PendingLinkIntent` - Raw decoded intent from JWT cookie, needs DB verification
  - `FailedLinkIntent` - Link flow initiated but verification failed, must reject
  - `isPendingIntent()` - Type guard for valid pending intent
  - `isFailedIntent()` - Type guard for failed intent (fail-closed rejection)
  - `linkIntentStore` - AsyncLocalStorage instance for request-scoped link intent propagation
  - Re-exports all from `./session.ts`
- **Files considered API:** `index.ts`, `session.ts`, `link-intent-store.ts`

## Responsibilities

- This directory **does**: Define shared TypeScript types for NextAuth session data, provide discriminated union types for link intent states, and provide the AsyncLocalStorage primitive for link-intent propagation
- This directory **does not**: Implement runtime authentication logic, handle session management, perform database I/O, or interact with React/Next.js APIs

## Usage

Import session types in application code or adapters:

```typescript
import type { Session, SessionUser } from "@/shared/auth";
```

## Standards

- Pure type definitions only
- Must remain framework-agnostic (no NextAuth runtime imports, no React, no Next.js)
- Types extend NextAuth base types via module augmentation

## Dependencies

- **Internal:** `@/types` (for global type augmentation)
- **External:** `next-auth` (for base Session/User types)

## Change Protocol

- Update this file when **Exports** change (new session properties)
- Bump **Last reviewed** date
- Update ESLint boundary rules if **Boundaries** changed
- Keep aligned with `src/auth.ts` JWT callbacks

## Notes

- Session types must match what NextAuth JWT callbacks populate
- `user_id` (UUID) is the canonical identity; `walletAddress` is nullable (null for OAuth-only users)
- Sign-out must be explicit user action only - no auto sign-out based on wallet state
- `link-intent-store.ts` requires Node.js runtime (AsyncLocalStorage) — not compatible with Edge
