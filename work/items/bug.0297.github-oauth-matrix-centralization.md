---
id: bug.0297
type: bug
title: "GitHub OAuth is broken across the deployment matrix; centralize it behind one auth hub"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "GitHub OAuth redirect_uri validation breaks across operator/poly/resy preview-canary-prod deployments because each node currently behaves like its own OAuth app. Replace per-node GitHub callbacks with one centralized auth hub and make every node a confidential client."
outcome: "One GitHub OAuth app and one callback URL serve all deployments. Operator, poly, and resy authenticate through a shared auth hub while preserving stable user_id reconciliation and local GitHub linking."
spec_refs:
  [spec.multi-node-tenancy, identity-model-spec, decentralized-user-identity]
assignees: derekg1729
credit:
project: proj.operator-plane
branch: bug/0297-github-oauth-hub-prototype
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-09
updated: 2026-04-09
labels: [auth, oauth, github, multi-node]
external_refs: []
---

# GitHub OAuth is broken across the deployment matrix

## Problem

GitHub OAuth currently depends on node-local callback URLs such as:

- `https://operator-*.cognidao.org/api/auth/callback/github`
- `https://poly-*.cognidao.org/api/auth/callback/github`
- `https://resy-*.cognidao.org/api/auth/callback/github`

That does not scale across preview, canary, and production because the GitHub
OAuth app only trusts a single callback URL/base domain. Result: GitHub sign-in
fails across the deployment matrix with `redirect_uri is not associated with
this application`.

## Requirements

### Functional

- Introduce a dedicated auth hub node for GitHub OAuth
- Register one first-party confidential client per node origin
- Keep SIWE local to each node
- Keep local GitHub linking available through the shared hub-backed GitHub provider
- Preserve canonical `user_id` semantics from the identity specs
- Rekey legacy local GitHub users to hub `sub` on first successful sign-in when safe

### Operational

- Auth hub must be runnable in local dev alongside operator/poly/resy
- Local DB setup must provision and migrate the auth DB
- Test stack setup must provision and migrate the auth DB
- Provide focused auth regression tests plus local end-to-end validation steps

## Allowed Changes

- `nodes/auth/**`
- `nodes/*/app/src/auth.ts`
- `nodes/*/app/src/shared/env/**`
- `packages/node-shared/src/contracts/**`
- `packages/db-schema/package.json`
- root dev/test/env scripts and documentation

## Plan

- [ ] Add centralized auth hub app using Better Auth + GitHub social provider + OAuth provider plugin
- [ ] Export shared auth-hub claims contract for node-side parsing
- [ ] Switch node GitHub auth to hub-backed OIDC while preserving provider id `github`
- [ ] Rekey legacy local GitHub users to canonical hub `sub` when needed
- [ ] Wire auth hub into local `dev:stack` and DB setup/migration flow
- [ ] Validate via focused auth tests, live stack HTTP checks, and UI/browser flow

## Validation

### Focused

1. `pnpm test:auth`
2. `pnpm typecheck`
3. `pnpm --filter @cogni/auth-app typecheck`

### Local Stack

1. `pnpm db:setup:nodes`
2. `pnpm dev:stack:full`
3. `curl http://localhost:3400/api/auth/.well-known/openid-configuration`
4. `curl http://localhost:3400/api/auth/oauth2/jwks`
5. Confirm operator/poly/resy show GitHub as a provider through the hub-backed flow
6. Confirm local GitHub link flow still routes through `/api/auth/link/github`
7. Complete a real GitHub round-trip with a local/dev GitHub OAuth app and verify consistent `user_id` across nodes

## Review Checklist

- [ ] Auth hub is the single GitHub callback surface
- [ ] Node GitHub sign-in uses hub claims, not per-node GitHub secrets
- [ ] Local GitHub linking still works
- [ ] Auth DB is part of local setup and test setup
- [ ] End-to-end validation evidence captured for discovery, authorize flow, and node integration
