---
id: proj.akash-crew-deploy
type: project
primary_charter:
title: "Akash Workload Deploy — ClusterProvider for Decentralized Cloud"
state: Active
priority: 2
estimate: 5
summary: "Implement ClusterProvider adapter for Akash Network. Deploy containerized workloads (MCP servers + AI agents) to decentralized cloud. ToolHive for MCP lifecycle on k8s. LangGraph orchestrator for NL-driven deployment."
outcome: "A user describes workloads in natural language, the system generates Akash SDL and deploys via the same ClusterProvider interface used for k8s. Mock adapter proves the flow e2e in v0."
assignees: [derekg1729]
created: 2026-03-26
updated: 2026-03-27
labels: [infra, akash, mcp, agents]
---

# Akash Workload Deploy — ClusterProvider for Decentralized Cloud

## Goal

Add Akash Network as a deployment target via the existing `ClusterProvider` interface from node-launch. No new ports, no new domain entities. SDL generation is an adapter-internal utility. ToolHive manages MCP servers on k8s; we translate the same patterns to SDL for Akash.

## Roadmap

### Crawl (P0)

**Goal:** Testable e2e flow with mock provider. HTTP API accepts workload specs, generates SDL, returns deployment info. Orchestrator graph converts NL to workload specs. Prove it with curl.

| Deliverable                                                             | Status    | Est | Work Item |
| ----------------------------------------------------------------------- | --------- | --- | --------- |
| `@cogni/container-runtime` package + `services/akash-deployer` HTTP API | In Review | 3   | task.0203 |
| Orchestrator graph — NL to workload specs via DI (no hard imports)      | In Review | 1   | task.0203 |
| GitOps manifests — Kustomize base + overlays + ArgoCD                   | Done      | 1   | task.0203 |
| Spec (4-layer container runtime architecture)                           | Done      | 1   | task.0203 |
| E2E validation — curl proof of full deploy lifecycle                    | Done      | 1   | task.0203 |

### Walk (P1)

**Goal:** Live Akash deployment on testnet. ToolHive for k8s MCP management. Cosmos wallet for AKT funding.

| Deliverable                                                       | Status      | Est | Work Item            |
| ----------------------------------------------------------------- | ----------- | --- | -------------------- |
| ToolHive operator spike — install, deploy MCPServer CRD, validate | Not Started | 2   | (create at P1 start) |
| Evaluate @akashnetwork/akashjs SDK                                | Not Started | 1   | (create at P1 start) |
| AkashSdlProvider implementing ClusterProvider — testnet deploy    | Not Started | 3   | (create at P1 start) |
| Cosmos wallet package — port + mnemonic adapter for AKT funding   | Not Started | 2   | (create at P1 start) |
| OAuth credential collection flow for MCP servers                  | Not Started | 2   | (create at P1 start) |

### Run (P2+)

**Goal:** Mainnet, bridge, monitoring, multi-workload orchestration.

| Deliverable                                      | Status      | Est | Work Item            |
| ------------------------------------------------ | ----------- | --- | -------------------- |
| Akash mainnet with stable payments (axlUSDC)     | Not Started | 3   | (create at P2 start) |
| EVM → Cosmos bridge (Squid Router)               | Not Started | 5   | (create at P2 start) |
| Deployment monitoring — status, logs, cost       | Not Started | 3   | (create at P2 start) |
| Dynamic MCP resolution via ToolHive registry API | Not Started | 2   | (create at P2 start) |

## Constraints

- `ClusterProvider` is the only deployment port — no bespoke port abstractions
- No standalone packages for v0 — all Akash code lives in the service
- ToolHive for MCP management on k8s — no bespoke MCP registry
- Graph receives all capabilities via DI — no hard infrastructure imports
- SDL generation is adapter-internal — not a public API

## Dependencies

- [ ] k3s + ArgoCD GitOps foundation (task.0149)
- [ ] ToolHive operator available in cluster (P1)
- [ ] Akash testnet account with AKT (P1)
- [ ] @akashnetwork/akashjs SDK evaluation (P1)

## As-Built Specs

- [Akash Deploy Service Spec](../../docs/spec/akash-deploy-service.md) — draft

## Design Notes

**v0 simplification (2026-03-26):** Deleted `@cogni/akash-client` and `@cogni/cosmos-wallet` packages. SDL generator moved into service. MCP registry replaced by ToolHive. `ClusterProvider` from node-launch is the only port. No new domain entities — workloads are container specs, not "crews."

**ToolHive (2026-03-26):** Stacklok's ToolHive is an enterprise MCP server platform with k8s operator, built-in registry, CRD-based definitions, and automatic RBAC/service discovery. Replaces our hardcoded 10-server registry entirely. k8s-native only — Akash path translates same container specs to SDL.
