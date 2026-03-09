---
id: spike.0037
type: spike
title: Research Tailscale/Headscale mesh VPN for Cogni infrastructure
status: needs_research
priority: 2
estimate: 1
summary: Evaluate Tailscale (via Headscale OSS) for secure inter-node networking — when in the roadmap it becomes valuable and what problems it solves vs current architecture
outcome: Research document with timing recommendation and proposed future project layout
spec_refs:
  - security-auth-spec
  - rbac-spec
  - spec.tenant-connections
  - environments-spec
project:
assignees:
  - cogni-dev
credit:
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-12
labels:
  - networking
  - security
  - infrastructure
  - research
external_refs:
  - docs/research/tailscale-headscale-mesh-vpn.md
revision: 0
blocked_by:
deploy_verified: false
rank: 17
---

# Research: Tailscale/Headscale Mesh VPN for Cogni Infrastructure

## Question

Should Cogni adopt Tailscale (via Headscale, the OSS coordination server) for secure inter-node networking? If so, when in the roadmap?

## Summary of Findings

**Recommendation: P3+ future — do not adopt now.**

Tailscale/Headscale is a WireGuard-based mesh VPN that adds automatic key distribution, NAT traversal, MagicDNS service discovery, and fine-grained ACLs on top of WireGuard tunnels. Headscale (26k+ GitHub stars, BSD-3-Clause) is the self-hosted coordination server.

**Why not now:**

- We run everything on a single VM per environment — no cross-VM traffic to encrypt
- Docker networks + Caddy TLS already handle our needs
- Our SIWE identity model doesn't map natively to Headscale's OIDC auth
- Adding another service is pure operational overhead with zero benefit today

**When to reconsider:** When we deploy to a second VM that needs to talk to the first (multi-VM deployment, Operator extraction, remote sandbox GPUs, multi-Node federation).

**Key alternative to evaluate when triggered:** NetBird (full-stack OSS, no vendor protocol dependency) vs Headscale (polished Tailscale clients, larger community).

## Validation

- [x] Research document written: `docs/research/tailscale-headscale-mesh-vpn.md`
- [x] Current security infrastructure surveyed (SIWE, proxy, Docker networks, Caddy TLS)
- [x] Tailscale/Headscale architecture and features researched
- [x] Alternatives evaluated (plain WireGuard, Nebula, ZeroTier, NetBird)
- [x] Timing recommendation made (P3+ future, not now)
- [x] Trigger conditions defined (multi-VM deployment)
- [x] Proposed future project layout included in research doc

## Research Document

See [docs/research/tailscale-headscale-mesh-vpn.md](../../docs/research/tailscale-headscale-mesh-vpn.md) for full findings, trade-off analysis, and proposed future project layout.
