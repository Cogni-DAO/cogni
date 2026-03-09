---
id: chr.engineering
type: charter
title: "ENGINEERING Charter"
state: Active
summary: ENGINEERING governance charter scaffold for recurring heartbeat runs.
created: 2026-02-15
updated: 2026-02-15
---

# ENGINEERING Charter

## Goal

Ship reliable code that brings charters' goals to life. Maintain quality through testing, CI/CD, and optimization loops. Build skills and workflows that accelerate delivery.

See [@docs/spec/development-lifecycle.md](../../docs/spec/development-lifecycle.md) for workflow standards.

## Charter Work Requests

_Updated by governance skills - shows what work other charters need from ENGINEERING_

| Charter | Priority | Severity | Work Item                      | Status      | Notes                                               |
| ------- | -------- | -------- | ------------------------------ | ----------- | --------------------------------------------------- |
| SUSTAIN | 0        | High     | `proj.observability-hardening` | Queued      | BLOCKING: Can't optimize what you can't see         |
| COMM    | 0        | High     | `proj.messenger-channels`      | Queued      | BLOCKING: P0 for community reach                    |
| SUSTAIN | 1        | High     | `proj.context-optimization`    | In Progress | $5.50/run unsustainable (needs observability first) |
| SUSTAIN | 1        | Med      | `proj.governance-agents`       | Queued      | Signal infra for governance loops                   |
| COMM    | 2        | Low      | `proj.sourcecred-onchain`      | Paused      | Cred system doesn't run                             |

## Principles

- **Maximize OSS**: Prefer open-source tools and dependencies over proprietary/vendor solutions
- **Test-first reliability**: Code only works if tested end-to-end and aligned with spec invariants
- **Workflow discipline**: Follow the [status-driven lifecycle](../../docs/spec/development-lifecycle.md) — every `needs_*` status maps to one `/command`, dispatched deterministically

## Key References

| Type  | Path                                                                                  | Purpose                           |
| ----- | ------------------------------------------------------------------------------------- | --------------------------------- |
| Spec  | [@docs/spec/architecture.md](../../docs/spec/architecture.md)                         | System architecture and hex ports |
| Spec  | [@docs/spec/services-architecture.md](../../docs/spec/services-architecture.md)       | Service boundaries and deployment |
| Spec  | [@docs/spec/system-test-architecture.md](../../docs/spec/system-test-architecture.md) | Test infrastructure patterns      |
| Spec  | [@docs/spec/development-lifecycle.md](../../docs/spec/development-lifecycle.md)       | Command-driven workflows          |
| Guide | [@work/README.md](../README.md)                                                       | Work management guide             |
| Index | [@work/items/\_index.md](../items/_index.md)                                          | Canonical work item index         |

## Projects

### Core mission / priorities

| Priority | Target                                                                 | Score (0-5) | Status      | Notes |
| -------- | ---------------------------------------------------------------------- | ----------- | ----------- | ----- |
| 0        | Delivery velocity: tight feedback loops accelerate workflow efficiency | 0           | Not Started |       |
| 1        | Test infrastructure: agents + humans validate before ship              | 0           | Not Started |       |
| 2        | Code quality: specs enforced, best practices followed                  | 0           | Not Started |       |

### Top projects (max 4)

_ENGINEERING-owned infrastructure. Feature delivery projects live in their respective charters; GOVERN handles cross-charter prioritization._

| Project                         | Why now                                      | Score (0-5) | Status      | Notes |
| ------------------------------- | -------------------------------------------- | ----------- | ----------- | ----- |
| `proj.development-workflows`    | Standardize spec/PR/agent workflows          | 0           | Not Started |       |
| `proj.agent-dev-testing`        | Self-validating agents (lint/test/e2e gates) | 0           | Not Started |       |
| `proj.system-test-architecture` | Mock-LLM test infra, system integration      | 0           | Not Started |       |
| `proj.context-optimization`     | Token efficiency for multi-call workflows    | 0           | Not Started |       |

## Constraints

- Development execution 100% dependent on one human (Derek)
- No CI/CD for governance workflows yet (only app CI exists)
- Agents cannot run full stack/comp tests to self-validate code before submitting PRs
- Limited test coverage for governance/scheduler infrastructure
- Development workflows brand new, require iteration and refinement

### Skills / resources

| Resource               | Use                                | Where                                | /skill | Notes                    |
| ---------------------- | ---------------------------------- | ------------------------------------ | ------ | ------------------------ |
| Governance skills      | Charter-scoped governance runs     | `.openclaw/skills/gov-*`             |        | Trigger-routed execution |
| Development skills     | Status-driven lifecycle commands   | `.claude/commands/`                  |        | `needs_*` → `/command`   |
| Test infrastructure    | Mock-LLM, system integration tests | `tests/`, `docker-compose`           |        | Partial coverage         |
| CI/CD pipelines        | GitHub Actions workflows           | `.github/workflows/`                 |        | App CI only; no gov CI   |
| Specs and architecture | Technical contracts and boundaries | `docs/spec/`                         |        | Active specs enforce     |
| Work tracking system   | Projects, tasks, issues            | `work/`                              |        | Via OpenClaw skills      |
| Deployment health      | Per-service health, LLM cost       | `.openclaw/skills/deployment-health` | ✓      | v0 MVP - data incomplete |
