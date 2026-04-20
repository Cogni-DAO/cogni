# rust-node · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

A Docker-built Rust service that proves the extracted node-core and internal node-contract seams can be ported incrementally. It is intentionally a terminal-grade internal runtime, not a frontend node replacement.

## Pointers

- [Rust Node Platform Migration](../../docs/spec/rust-node-platform.md)
- [Candidate Flight V0](../../docs/guides/candidate-flight-v0.md)
- [Scheduler Spec](../../docs/spec/scheduler.md)
- [Services Architecture](../../docs/spec/services-architecture.md)

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["services", "packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "tests",
    "e2e",
    "infra"
  ]
}
```

## Structure

```
rust-node/
├── crates/
│   ├── cogni-rust-node-core/       # Pure Rust parity ports of node-core domains
│   ├── cogni-rust-node-contracts/  # Rust-side internal contract summaries + wire types
│   └── cogni-rust-node-runtime/    # Axum runtime shell + in-memory account/run tracking
├── fixtures/generated/             # TS-generated parity + contract fixtures (committed)
├── Cargo.toml                      # Local Rust workspace
├── Cargo.lock                      # Committed lockfile for Dockerized cargo reproducibility
└── Dockerfile                      # Candidate-flight image target
```

## Hard rules

- **TS_FIXTURES_AUTHORITATIVE:** Rust parity is proven against committed fixtures generated from TypeScript sources.
- **PURE_LOGIC_FIRST:** Keep pure domain code in `cogni-rust-node-core`; runtime wiring belongs in `cogni-rust-node-runtime`.
- **INTERNAL_RUNTIME_ONLY:** This service owns `/livez`, `/readyz`, and scheduler-facing internal grant/graph-run APIs only.
- **NO_HOST_RUST_REQUIRED:** Validation must work through repo-owned Dockerized cargo scripts.
- **ACCOUNT_TRACKING_DETERMINISTIC:** The v0 runtime uses explicit in-memory balance tracking with idempotency; do not smuggle in hidden persistence.

## Public Surface

- **Binary:** `cogni-rust-node-runtime`
- **Docker image:** `services/rust-node/Dockerfile`
- **Commands:** `pnpm rust:fixtures`, `pnpm rust:fixtures:check`, `pnpm rust:test`, `pnpm rust:check`
- **Ports:** `9101` (`/livez`, `/readyz`, internal graph-run endpoints)
- **HTTP:** `POST /api/internal/grants/{grantId}/validate`, `POST /api/internal/graph-runs`, `PATCH /api/internal/graph-runs/{runId}`, `POST /api/internal/graphs/{graphId}/runs`
- **Env:**
  - `SCHEDULER_API_TOKEN` — required bearer for internal endpoints
  - `HOST`, `PORT` — bind address
  - `DEFAULT_ACCOUNT_BALANCE_CREDITS` — seed for unseen accounts
  - `GIT_SHA` — surfaced via `/readyz.version`

## Responsibilities

- This directory **does**: port pure node-core logic to Rust, keep parity fixtures current, expose a minimal internal runtime (including synthetic grant validation for worker compatibility), and stay deployable through Argo.
- This directory **does not**: replace Next.js UI, own real persistence, validate grants against the production DB, or bypass the TypeScript contract source of truth.

## Change Protocol

- Regenerate fixtures when touching parity-covered behavior.
- Update this file when crates, commands, ports, or env vars change.
- Keep runtime scope narrow; new HTTP surfaces require a spec/task update first.

## Notes

- `fixtures/generated/` is committed source material for Rust parity tests; regenerate it instead of hand-editing JSON.
- The runtime deliberately uses synthetic grant validation plus in-memory account balances for the v0 candidate-flight lane.
