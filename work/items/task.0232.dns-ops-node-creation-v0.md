---
id: task.0232
type: task
title: "dns-ops v0 — DNS layer for multi-node creation pipeline"
status: needs_merge
priority: 1
rank: 2
estimate: 3
summary: "@cogni/dns-ops package with Cloudflare + Namecheap adapters, create-node CLI wizard, destroy-node cleanup, protected record safeguards, and wildcard DNS setup. Unblocks task.0202 (provisionNode workflow) by delivering Activity 0: DNS provisioning."
outcome: "Running `npx tsx packages/dns-ops/scripts/create-node.ts <slug>` creates a DNS record at <slug>.nodes.cognidao.org and outputs a node-spec JSON fragment. destroy-node reverses it. Wildcard DNS covers all future nodes."
spec_refs: node-launch-spec, node-formation-spec
assignees: derekg1729
credit:
project: proj.node-formation-ui
branch: worktree-feat+domain-ops
pr:
reviewer: derekg1729
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [infra, dns, multi-tenant, node-formation]
external_refs:
---

# dns-ops v0 — DNS Layer for Multi-Node Creation Pipeline

## Context

The provisionNode workflow (task.0202) needs DNS provisioning as its first infrastructure step. This task builds the `@cogni/dns-ops` package and the create-node CLI wizard that generates DNS records and node-spec fragments. It's the foundation that task.0202's activities build on.

## What's Done (on branch `worktree-feat+domain-ops`)

- [x] `@cogni/dns-ops` package — Cloudflare + Namecheap adapters, `DomainRegistrarPort` + `TargetedDnsPort` interfaces
- [x] `upsertDnsRecord` / `removeDnsRecord` helpers with read-modify-write safety
- [x] Protected record safeguards — `@`, `www` blocked from modification
- [x] 31 unit tests (adapters, helpers, safeguards)
- [x] Cloudflare setup guide (`packages/dns-ops/docs/cloudflare-dns-setup.md`)
- [x] `.env.local.example` scaffolding for `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`
- [x] `create-node.ts` wizard — creates DNS + outputs node-spec JSON
- [x] Live verified: `resy-helper.nodes.cognidao.org` resolves

## Requirements (remaining for merge)

### destroy-node cleanup script

- [ ] `packages/dns-ops/scripts/destroy-node.ts` — accepts slug, removes DNS record
- [ ] Verifies record exists before deletion
- [ ] Outputs confirmation with removed record details
- [ ] Tested: create → destroy → verify gone

### Wildcard DNS (one-time setup)

- [ ] Create `*.nodes` A record pointing to cluster ingress IP
- [ ] Document in cloudflare-dns-setup.md
- [ ] This eliminates per-node DNS creation — all subdomains auto-resolve
- [ ] Keep per-node DNS as fallback (when wildcard isn't available or custom IPs needed)

### Lint/CI compliance

- [ ] All files pass `pnpm check` (biome + prettier + headers + docs)
- [ ] Scripts pass lint (add biome-ignore directives for CLI console/env usage)
- [ ] Add `@cogni/dns-ops` to root `package.json` workspace dependencies
- [ ] AGENTS.md for `packages/dns-ops/`

### Integration hooks for task.0202

- [ ] Export `createNodeDns(slug, config)` and `destroyNodeDns(slug, config)` as clean functions (not just scripts)
- [ ] These become Activity 0 in the provisionNode Temporal workflow
- [ ] Config takes Cloudflare credentials + domain + target IP

## Allowed Changes

- `packages/dns-ops/` — all files (this is the new package)
- `.env.local.example` — Cloudflare env vars section
- `tsconfig.json` — dns-ops reference
- `pnpm-lock.yaml` — new dependency (fast-xml-parser)
- `work/items/task.0232.*` — this file
- `work/projects/proj.node-formation-ui.md` — add task.0232 to roadmap

## Plan

- [ ] Step 1: Add destroy-node script (mirror of create-node)
- [ ] Step 2: Extract `createNodeDns` / `destroyNodeDns` from scripts into `src/domain/node-dns.ts` (reusable functions)
- [ ] Step 3: Set up wildcard DNS record (`*.nodes.cognidao.org`)
- [ ] Step 4: Add AGENTS.md for packages/dns-ops/
- [ ] Step 5: Fix remaining lint issues (scripts biome-ignore, root package.json dep)
- [ ] Step 6: `pnpm check` clean
- [ ] Step 7: Update project roadmap with task.0232
- [ ] Step 8: PR to staging

## Validation

**Command:**

```bash
pnpm vitest run packages/dns-ops/tests/
pnpm check
```

**Expected:** 31+ tests pass. All static checks clean.

**Live validation:**

```bash
# Create
source .env.local && export CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID
npx tsx packages/dns-ops/scripts/create-node.ts test-node
dig test-node.nodes.cognidao.org +short @1.1.1.1
# → should resolve

# Destroy
npx tsx packages/dns-ops/scripts/destroy-node.ts test-node
dig test-node.nodes.cognidao.org +short @1.1.1.1
# → should not resolve
```

## Review Checklist

- [ ] **Work Item:** `task.0232` linked in PR body
- [ ] **Spec:** node-launch-spec invariants upheld (WILDCARD_DNS, NAMESPACE_ISOLATION)
- [ ] **Tests:** 31+ unit tests, protected record safeguards verified
- [ ] **Security:** Cloudflare API token never logged, protected records (@, www) cannot be modified
- [ ] **Reviewer:** assigned and approved

## Architecture: How dns-ops Fits the Node Pipeline

```
task.0232 (this)          task.0202 (next)
─────────────────         ─────────────────────────────────
create-node wizard   →    provisionNode Temporal workflow
  └─ DNS record             ├─ Activity 0: createNodeDns ← from dns-ops
  └─ node-spec JSON         ├─ Activity 1: createNodeRecord
                             ├─ Activity 2: createRepoFromTemplate
                             ├─ Activity 3: generateNodeSecrets
                             ├─ Activity 4: provisionDatabase
                             ├─ Activity 5: materializeOverlay
                             ├─ Activity 6: activatePayments
                             ├─ Activity 7: waitForHealth
                             └─ Activity 8: markNodeReady
```

## PR / Links

- Branch: `worktree-feat+domain-ops`
- Unblocks: task.0202 (provisionNode workflow)
- Related: proj.node-formation-ui (Walk/P1 roadmap)

## Attribution

- derekg1729: design, review
- claude: implementation, testing, Cloudflare setup guide
