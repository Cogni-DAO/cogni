# vcs · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

REST API routes for VCS operations — CI-gated candidate-a flight dispatch for external AI agents.

## Pointers

- [Agentic Contribution Loop](../../../../../../../docs/spec/agentic-contribution-loop.md)
- [VCS Integration Spec](../../../../../../../docs/spec/vcs-integration.md)
- [VCS Flight Contract](../../../../../../../../packages/node-contracts/src/vcs.flight.v1.contract.ts)

## Boundaries

```json
{
  "layer": "app",
  "may_import": ["bootstrap", "contracts", "shared", "ports"],
  "must_not_import": ["adapters", "core", "features"]
}
```

## Public Surface

- **Exports:** none (route handlers only)
- **Routes:**
  - `POST /api/v1/vcs/flight` — CI-gated candidate-a flight request; requires Bearer or session auth; 202 on dispatch, 422 if CI not green

## Ports

- **Uses ports:** `VcsCapability` (via container)
- **Implements ports:** none

## Responsibilities

- This directory **does:** verify CI green for PR head SHA, dispatch `candidate-flight.yml` via `VcsCapability`, return dispatch metadata.
- This directory **does not:** own the slot lease (workflow owns it), poll for run ID, write any DB state.

## Standards

- All routes auth-protected (Bearer token or SIWE session required)
- Input/output validated via `flightOperation` Zod contract
- No direct Octokit — all GitHub calls go through `VcsCapability`

## Dependencies

- **Internal:** `@cogni/node-contracts` (flightOperation), `@/bootstrap/container`, `@/shared/config/repoSpec.server`, `@/app/_lib/auth/session`
- **External:** next/server

## Change Protocol

- Update this file when **Routes** or **VcsCapability** interface changes
- Update `vcs.flight.v1.contract.ts` first if request/response shape changes

## Notes

- Slot lease is owned by `candidate-flight.yml` workflow — not this route
- v0 single-tenant: `getGithubRepo()` returns the operator's own repo (task.0122 adds multi-tenant)
