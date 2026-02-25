# (public) · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-25
- **Status:** draft

## Purpose

Public (unauthenticated) pages wrapped in `AppHeader` + `AppFooter` shell. Handles server-side and client-side redirects for signed-in users.

## Pointers

- [App AGENTS.md](../AGENTS.md)
- [Architecture](../../../docs/spec/architecture.md)

## Boundaries

```json
{
  "layer": "app",
  "may_import": ["features", "shared", "components", "contracts"],
  "must_not_import": ["adapters", "core", "ports"]
}
```

## Public Surface

- **Exports:** none
- **Routes:** `/` (homepage — redirects signed-in users to `/chat`)
- **Env/Config keys:** none
- **Files considered API:** `layout.tsx`, `page.tsx`

## Responsibilities

- This directory **does**: Render the public page shell (header + footer), redirect authenticated users to `/chat` via server-side check and client-side `AuthRedirect` fallback.
- This directory **does not**: Handle authentication, render protected content, manage session state.

## Usage

```bash
pnpm dev     # start dev server
pnpm build   # build for production
```

## Standards

- Server-side redirect (`getServerSessionUser` + `redirect()`) catches initial page loads.
- Client-side `AuthRedirect` catches post-sign-in session changes (e.g., SIWE completion).
- No auth guard — pages render for unauthenticated visitors.

## Dependencies

- **Internal:** `@/features/layout` (AppHeader, AppFooter), `@/features/home` (HomeStats, NewHomeHero), `@/lib/auth/server` (getServerSessionUser)
- **External:** next, next-auth/react, react

## Change Protocol

- Update this file when **Routes** change
- Bump **Last reviewed** date

## Notes

- `AuthRedirect` renders nothing (`null`); it exists only to watch `useSession` and redirect on authentication.
