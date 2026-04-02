---
name: new-node
description: "End-to-end orchestration for creating a new sovereign Cogni node. Covers the full lifecycle: intake interview, DAO formation, template scaffolding, branding, graph wiring, PR, and DNS. Use this skill whenever someone asks to create a node, add a node, set up a new node, onboard a new DAO, or spin up a new Cogni instance — even if they don't use the word 'node' exactly. This is a high-stakes, multi-phase workflow that requires careful thinking at every step."
---

# New Node — Full Lifecycle Orchestration

You are a node creation agent. Your job: take a node request from first contact to a reviewable PR with DNS configured. This is not a template-copy exercise — each node is a sovereign AI organization, and getting the identity right matters more than speed.

Think deeply at every phase. A bad name or misaligned mission is harder to fix than a bug.

## References (read the relevant guide when you reach each phase)

- [Creating a New Node](../../../docs/guides/creating-a-new-node.md) — technical scaffolding steps
- [New Node Styling Guide](../../../docs/guides/new-node-styling.md) — 4-file branding checklist
- [Multi-Node Dev Guide](../../../docs/guides/multi-node-dev.md) — running, testing, DB/auth
- [Node Formation Guide](../../../docs/guides/node-formation-guide.md) — DAO wizard walkthrough
- [Node Formation Spec](../../../docs/spec/node-formation.md) — governance identity design
- [dns-ops skill](../dns-ops/SKILL.md) — DNS subdomain creation
- [node-setup skill](../node-setup/SKILL.md) — full operator deployment (for context, not for node creation)

## The Node Lifecycle

```
 1. INTAKE          — Who wants this? What's the mission?
 2. IDENTITY        — 1-word name, mission statement, theme direction
 3. DAO FORMATION   — On-chain governance via /setup/dao wizard
 4. SCAFFOLDING     — Branch, copy template, rename, wire
 5. BRANDING        — Icon, colors, metadata, homepage, chat suggestions
 6. GRAPHS          — Node-specific AI brain + tools
 7. VALIDATION      — Typecheck, dev server, manual smoke test
 8. PULL REQUEST    — PR to integration/multi-node (or staging)
 9. DNS             — Subdomain via dns-ops
```

Each phase has a gate. Do not advance until the gate is met.

---

## Phase 1: Intake

**Goal:** Understand who is requesting the node and why.

Questions to answer (ask the user, or extract from conversation context):

- Who is the requesting party? (individual, team, existing DAO?)
- What domain does this node serve? (prediction markets, restaurants, research, etc.)
- Is there an existing community or is this greenfield?
- What AI capabilities does the node need? (what should the brain do?)

Don't rush this. A node that nobody needs is worse than no node at all. If the request is vague or the mission isn't clear, push back and ask harder questions.

**Gate:** You can articulate the node's purpose in one sentence that a stranger would understand.

---

## Phase 2: Identity

**Goal:** Lock in name + mission + theme direction.

### Name rules

- **One word**, lowercase, memorable. It becomes the slug everywhere: `nodes/{name}/`, `@cogni/{name}-app`, `cogni/{name}` in the header, `{name}.nodes.cognidao.org`.
- Must not collide with existing nodes. Check: `ls nodes/`
- Must not be a reserved word (operator, template, admin, api, auth, setup, app, web)

### Mission statement

One sentence. Goes in `repo-spec.yaml` description and `layout.tsx` metadata. Examples:
- poly: "Community AI prediction trading"
- resy: "AI-powered restaurant reservations"

### Theme direction

Suggest a Lucide icon and a primary hue (HSL). Present 2-3 options with rationale. The user picks.

| Hue range | Feel | Example nodes |
|-----------|------|---------------|
| 160-170 (teal/emerald) | Data, prediction, growth | poly |
| 20-35 (amber/orange) | Energy, food, warmth | resy candidate |
| 270-290 (purple) | Creative, governance, premium | — |
| 340-355 (rose) | Social, health, care | — |

**Gate:** User has confirmed: name, mission sentence, icon choice, and primary hue.

---

## Phase 3: DAO Formation

**Goal:** On-chain DAO deployed, repo-spec fragment generated.

This phase requires the user's browser and wallet. You cannot do it for them.

1. Confirm the dev server is running (`pnpm dev:stack` or `pnpm dev`)
2. Direct user to `http://localhost:3000/setup/dao`
3. They fill in 3 fields (tokenName, tokenSymbol, initialHolder) and sign 2 transactions
4. The wizard returns a repo-spec YAML fragment
5. User pastes the YAML — you save it to `nodes/{name}/.cogni/repo-spec.yaml`

Read [Node Formation Guide](../../../docs/guides/node-formation-guide.md) for the detailed walkthrough if needed.

**Gate:** `nodes/{name}/.cogni/repo-spec.yaml` has valid `cogni_dao.chain_id` and `payments.status: pending_activation`.

---

## Phase 4: Scaffolding

**Goal:** Working node directory with correct package names, env vars, DB, and scripts.

This phase has real teeth — it's not just a copy. The node needs its own database, auth secret, billing endpoint, and a dev script that remaps env vars at runtime. Read [Creating a New Node](../../../docs/guides/creating-a-new-node.md) for the mechanical checklist.

### 4a. Branch

```bash
git checkout -b feat/{name}-node origin/integration/multi-node
```

If `integration/multi-node` doesn't exist yet, branch from `staging`.

### 4b. Copy template

```bash
cp -r nodes/node-template/ nodes/{name}/
```

### 4c. Rename packages

| File | Change |
|------|--------|
| `nodes/{name}/app/package.json` | `name` → `@cogni/{name}-app`, port in `dev`/`start` |
| `nodes/{name}/graphs/package.json` | `name` → `@cogni/{name}-graphs` |
| `nodes/{name}/.cogni/repo-spec.yaml` | Already populated from Phase 3 wizard output |

**Port assignment:** Check existing ports (`grep -r '"dev":.*-p' nodes/*/app/package.json`) and pick the next available in the 3x00 range.

### 4d. Register in operator repo-spec

Add an entry to the operator's `.cogni/repo-spec.yaml` `nodes[]` array. The `node_id` comes from the DAO wizard output (Phase 3).

```yaml
nodes:
  # ... existing entries ...
  - node_id: "<uuid-from-wizard>"
    node_name: "{Display Name}"
    path: "nodes/{name}"
    endpoint: "http://{name}:{port}/api/internal/billing/ingest"
```

The `endpoint` field is currently **declaration-only** — not consumed at runtime. The billing router reads `COGNI_NODE_ENDPOINTS` env var instead (see 4e). Future: auto-generate env var from repo-spec at startup.

### 4e. Wire environment variables

Each node gets its own database and auth secret. This is the v0 env var checklist — for the full propagation story (CI, Docker Compose, deploy.sh), see `.cursor/commands/env-update.md`.

**Add to `.env.local` and `.env.local.example`:**

```bash
DATABASE_URL_{NAME}="postgresql://app_user:password@localhost:55432/cogni_{name}"
DATABASE_SERVICE_URL_{NAME}="postgresql://service_user:password@localhost:55432/cogni_{name}"
AUTH_SECRET_{NAME}="{name}-dev-secret-at-least-32-characters-change-me!!"
```

**Update existing vars in `.env.local`:**

```bash
# Append to COGNI_NODE_DBS (comma-separated list of DBs to provision)
COGNI_NODE_DBS=cogni_operator,cogni_poly,cogni_resy,cogni_{name}

# Append to COGNI_NODE_ENDPOINTS — keys MUST be node_id UUIDs (not slugs).
# The billing callback router stamps UUIDs in metadata and looks them up here.
COGNI_NODE_ENDPOINTS=...,<node-uuid>=http://host.docker.internal:{port}/api/internal/billing/ingest
```

**Also update `.env.test` and `.env.test.example`** with test-safe equivalents.

### 4f. Wire root scripts

Add to root `package.json`:

```json
"dev:{name}": "COGNI_REPO_PATH=$(pwd)/nodes/{name} NEXTAUTH_URL=http://localhost:{port} dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_{NAME} DATABASE_SERVICE_URL=$DATABASE_SERVICE_URL_{NAME} AUTH_SECRET=$AUTH_SECRET_{NAME} pnpm --filter @cogni/{name}-app dev'",
"typecheck:{name}": "tsc -p nodes/{name}/app/tsconfig.app.json --noEmit"
```

The `dev:{name}` script sets `COGNI_REPO_PATH` to the node's own directory (not repo root), then remaps per-node env vars (`DATABASE_URL_{NAME}` → `DATABASE_URL`) at runtime. Follow the exact pattern from `dev:poly` / `dev:resy`.

### 4g. Wire migration script

Add to root `package.json`:

```json
"db:migrate:{name}": "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_{NAME} tsx node_modules/drizzle-kit/bin.cjs migrate'"
```

Then add `pnpm db:migrate:{name}` to the `db:migrate:nodes` composite script (it's a sequential chain of per-node migrations).

### 4h. Provision database

```bash
pnpm install
pnpm db:provision:nodes    # creates cogni_{name} DB + roles via COGNI_NODE_DBS
pnpm db:migrate:nodes      # runs Drizzle migrations on all node DBs sequentially
```

### 4i. Verify template rename is complete

```bash
grep -r "node-template" nodes/{name}/
```

Every hit must be renamed. Common misses: package.json name, AGENTS.md references, import paths.

**Gate:** `pnpm typecheck:{name}` passes with zero errors. Database exists (`psql -h localhost -p 55432 -U app_user -d cogni_{name} -c '\dt'` shows tables).

---

## Phase 5: Branding

**Goal:** Node has its own visual identity.

Read [New Node Styling Guide](../../../docs/guides/new-node-styling.md) and apply all 5 customizations:

1. **Icon + name** in `AppHeader.tsx` + `AppSidebar.tsx`
2. **Theme colors** in `tailwind.css` — update `--primary`, `--ring`, `--sidebar-*`, `--accent-*` using the chosen hue
3. **Metadata** in `layout.tsx` — title + description
4. **Homepage** in `(public)/page.tsx` — hero text, CTAs tailored to the node's domain
5. **Chat suggestions** in `ChatComposerExtras.tsx` — domain-specific starter prompts

**Gate:** Dev server shows correct icon, name (`cogni/{name}`), and theme color. Signed-in sidebar matches.

---

## Phase 6: Graphs

**Goal:** Node has at least one custom AI graph (its "brain").

Create `nodes/{name}/graphs/src/graphs/{name}-brain/`:

```
{name}-brain/
  graph.ts      — Graph factory using createReactAgent or custom StateGraph
  prompts.ts    — System prompt defining the brain's personality + capabilities
  tools.ts      — Tool ID constants for capability lookup
```

Update `nodes/{name}/graphs/src/graphs/index.ts` to export the new graph.

The system prompt is the soul of the node. Write it with care — it defines how the AI behaves, what it knows, and what it refuses to do. Reference the node's mission statement.

For v0, a ReAct agent with the shared tool catalog is sufficient. Specialized tools come later.

**Gate:** Graph builds (`pnpm --filter @cogni/{name}-graphs build`) and exports are correct.

---

## Phase 7: Validation

**Goal:** Everything works end-to-end locally.

```bash
# Typecheck
pnpm typecheck:{name}

# Start (requires pnpm dev:stack in another terminal)
pnpm dev:{name}

# Manual checks:
# - Homepage loads at http://localhost:{port}
# - Branding correct (icon, colors, name)
# - Sign in works (shared auth from operator)
# - Chat loads with custom suggestions
# - AI responds (if graphs are wired to execution host)
```

**Gate:** All checks pass. No TypeScript errors, no console errors, branding matches spec.

---

## Phase 8: Pull Request

**Goal:** Clean PR ready for review.

Target branch: `integration/multi-node` (or `staging` if integration branch is merged).

The PR should include:
- `nodes/{name}/` — full node directory
- Root `package.json` — new `dev:{name}` and `typecheck:{name}` scripts
- `.env.local.example` / `.env.test.example` — new per-node env vars
- Any other env propagation changes (see `.cursor/commands/env-update.md` for the full checklist)

The PR description should include:
- Node mission (one sentence)
- What the brain does
- Screenshot of the branded homepage (if possible)
- Link to the DAO transaction (chain explorer)

**Gate:** PR created, CI passes (typecheck at minimum).

---

## Phase 9: DNS

**Goal:** `{name}.nodes.cognidao.org` resolves.

Use the [dns-ops skill](../dns-ops/SKILL.md) or run directly:

```bash
source .env.local && export CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID
npx tsx packages/dns-ops/scripts/create-node.ts {name}
```

Verify: `dig {name}.nodes.cognidao.org +short @1.1.1.1`

Note: DNS will resolve but HTTPS won't work until task.0247 ships (cluster ingress + Caddy + TLS). This is expected.

**Gate:** DNS record exists and resolves.

---

## Anti-patterns

1. **Rushing identity.** A bad name sticks forever. Spend time on Phase 2.
2. **Skipping DAO formation.** Every node needs on-chain governance identity, even for dev/testing. Use Sepolia testnet if mainnet isn't ready.
3. **Copy-pasting without renaming.** Every `node-template` reference must become `{name}`. Grep for `node-template` in your node dir before moving on.
4. **Generic system prompts.** The brain's personality should be specific to the node's domain. "You are a helpful assistant" is not acceptable.
5. **Skipping validation.** The dev server must boot and render correctly before PR. Don't PR blind.

## Current Limitations (v0)

- **No production deployment.** Nodes run locally only until task.0247 ships (Docker Compose per-node, Caddy routing, per-node DB provisioning).
- **~3 GB RAM per node.** Each node is a full Next.js app copy. task.0248 (shared platform extraction) will fix this.
- **Biome doesn't lint nodes.** Catch issues via typecheck only.
- **Node typechecks not in `pnpm check` yet.** Run `pnpm typecheck:{name}` manually.
