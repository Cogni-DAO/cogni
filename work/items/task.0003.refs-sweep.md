---
id: task.0003
type: task
title: Sweep stale doc references across the codebase
status: needs_design
priority: 2
estimate: 3
summary: Replace ~560 stale refs to old docs/UPPER_CASE.md paths with new typed directory paths
outcome: Zero stale doc refs in codebase, all tracker Refs columns checked
spec_refs:
assignees: derekg1729
credit:
project: proj.maximize-oss-tools
branch:
pr:
reviewer:
created: 2026-02-08
updated: 2026-02-08
labels: [docs, refactor]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 16
---

# Sweep Stale Doc References

## Problem

97 legacy docs were migrated from `docs/UPPER_CASE_NAME.md` to typed directories (`docs/spec/`, `docs/guides/`, `docs/research/`, `work/initiatives/`). The content is moved, but **~560 references** to old paths remain scattered across the codebase.

## Scope

~560 actionable refs across:

- **AGENTS.md files** (~160 refs, 26%) — navigation sections in every directory
- **TypeScript files** (~220 refs, 36%) — `* Links:` doc-header comments
- **Markdown docs** (~150 refs, 25%) — cross-references in specs, initiatives, guides
- **Config/scripts** (~30 refs, 5%) — eslint, shell, toml, yaml

**Skip:** `.html` (Next.js build artifacts), `.claude/settings.local.json` (git history), `dist/`, `.next/`.

## Mapping Table

Use the tracker (`work/items/task.0001.docs-migration-tracker.md`) as the source of truth for old → new mappings. The columns are: `Original | Spec | Proj | WI | Guide`.

Rules:

- If **Spec** column has a value → primary ref target is `docs/spec/{value}`
- If only **Guide** column has a value → target is `docs/guides/{value}`
- If only **Proj** column has a value → target is `work/projects/{value}`
- If **State** is `obsolete` or `snapshot` with no destination → delete the reference or replace with the nearest living doc
- Some docs have BOTH spec + ini destinations. **For code references** (Links comments, AGENTS.md), point to the **spec**. For roadmap/TODO references, point to the **proj**.

### Quick Reference (top 30 by ref count)

| Old path                              | New path                             | Refs |
| ------------------------------------- | ------------------------------------ | ---- |
| `docs/ARCHITECTURE.md`                | `docs/spec/architecture.md`          | 71   |
| `docs/UI_IMPLEMENTATION_GUIDE.md`     | `docs/spec/ui-implementation.md`     | 56   |
| `docs/NODE_FORMATION_SPEC.md`         | `docs/spec/node-formation.md`        | 42   |
| `docs/SCHEDULER_SPEC.md`              | `docs/spec/scheduler.md`             | 40   |
| `docs/PAYMENTS_DESIGN.md`             | `docs/spec/payments-design.md`       | 31   |
| `docs/ACTIVITY_METRICS.md`            | `docs/spec/activity-metrics.md`      | 27   |
| `docs/ONCHAIN_READERS.md`             | `docs/spec/onchain-readers.md`       | 25   |
| `docs/DATABASE_RLS_SPEC.md`           | `docs/spec/database-rls.md`          | 24   |
| `docs/SANDBOXED_AGENTS.md`            | `docs/spec/sandboxed-agents.md`      | 22   |
| `docs/PAYMENTS_FRONTEND_DESIGN.md`    | _(obsolete, deleted)_                | 21   |
| `docs/SECURITY_AUTH_SPEC.md`          | `docs/spec/security-auth.md`         | 20   |
| `docs/PACKAGES_ARCHITECTURE.md`       | `docs/spec/packages-architecture.md` | 17   |
| `docs/DEPAY_PAYMENTS.md`              | _(archived)_                         | 17   |
| `docs/COGNI_BRAIN_SPEC.md`            | `docs/spec/cogni-brain.md`           | 12   |
| `docs/CHAIN_CONFIG.md`                | `docs/spec/chain-config.md`          | 11   |
| `docs/TOOL_USE_SPEC.md`               | `docs/spec/tool-use.md`              | 10   |
| `docs/STYLE.md`                       | `docs/spec/style.md`                 | 10   |
| `docs/OBSERVABILITY.md`               | `docs/spec/observability.md`         | 9    |
| `docs/FEATURE_DEVELOPMENT_GUIDE.md`   | `docs/guides/feature-development.md` | 9    |
| `docs/AUTHENTICATION.md`              | `docs/spec/authentication.md`        | 9    |
| `docs/TEMPORAL_PATTERNS.md`           | `docs/spec/temporal-patterns.md`     | 8    |
| `docs/LANGGRAPH_SERVER.md`            | `docs/spec/langgraph-server.md`      | 8    |
| `docs/LANGGRAPH_AI.md`                | `docs/spec/langgraph-patterns.md`    | 8    |
| `docs/TESTING.md`                     | `docs/guides/testing.md`             | 6    |
| `docs/DATABASES.md`                   | `docs/spec/databases.md`             | 5    |
| `docs/ENVIRONMENTS.md`                | `docs/spec/environments.md`          | 5    |
| `docs/GRAPH_EXECUTION.md`             | `docs/spec/graph-execution.md`       | 12   |
| `docs/CHECK_FULL.md`                  | `docs/spec/check-full.md`            | 4    |
| `docs/BILLING_EVOLUTION.md`           | `docs/spec/billing-evolution.md`     | 3    |
| `docs/ERROR_HANDLING_ARCHITECTURE.md` | `docs/spec/error-handling.md`        | 2    |

## Execution Checklist

### Mechanical Replacement (bulk of the work)

Most refs are a simple string replacement: `docs/UPPER_CASE.md` → `docs/spec/lower-case.md`. The `../` prefix chain doesn't change because the new path is still under `docs/`.

**Per-doc workflow (repeat for each row):**

```bash
# 1. DRY RUN — see what will change
grep -rn 'docs/ARCHITECTURE\.md' \
  --include='*.md' --include='*.ts' --include='*.tsx' \
  --include='*.mjs' --include='*.toml' --include='*.sh' \
  | grep -v 'wi.refs-sweep' | grep -v '> Source:'

# 2. REPLACE — across all file types
find . -type f \( -name '*.md' -o -name '*.ts' -o -name '*.tsx' \
  -o -name '*.mjs' -o -name '*.toml' -o -name '*.sh' \) \
  ! -path '*/wi.refs-sweep*' \
  -exec sed -i '' 's|docs/ARCHITECTURE\.md|docs/spec/architecture.md|g' {} +

# 3. VERIFY — should show only > Source: lines (if any) and the tracker
grep -rn 'docs/ARCHITECTURE\.md' \
  --include='*.md' --include='*.ts' --include='*.tsx' \
  --include='*.mjs' --include='*.toml' --include='*.sh'
```

**Full sed mapping (sorted by ref count, run top-to-bottom):**

```bash
# --- 71 refs ---
sed -i '' 's|docs/ARCHITECTURE\.md|docs/spec/architecture.md|g'
# --- 56 refs ---
sed -i '' 's|docs/UI_IMPLEMENTATION_GUIDE\.md|docs/spec/ui-implementation.md|g'
# --- 42 refs ---
sed -i '' 's|docs/NODE_FORMATION_SPEC\.md|docs/spec/node-formation.md|g'
# --- 40 refs ---
sed -i '' 's|docs/SCHEDULER_SPEC\.md|docs/spec/scheduler.md|g'
# --- 31 refs ---
sed -i '' 's|docs/PAYMENTS_DESIGN\.md|docs/spec/payments-design.md|g'
# --- 27 refs ---
sed -i '' 's|docs/ACTIVITY_METRICS\.md|docs/spec/activity-metrics.md|g'
# --- 25 refs ---
sed -i '' 's|docs/ONCHAIN_READERS\.md|docs/spec/onchain-readers.md|g'
# --- 24 refs ---
sed -i '' 's|docs/DATABASE_RLS_SPEC\.md|docs/spec/database-rls.md|g'
# --- 22 refs ---
sed -i '' 's|docs/SANDBOXED_AGENTS\.md|docs/spec/sandboxed-agents.md|g'
# --- 20 refs ---
sed -i '' 's|docs/SECURITY_AUTH_SPEC\.md|docs/spec/security-auth.md|g'
# --- 17 refs ---
sed -i '' 's|docs/PACKAGES_ARCHITECTURE\.md|docs/spec/packages-architecture.md|g'
# --- 12 refs ---
sed -i '' 's|docs/GRAPH_EXECUTION\.md|docs/spec/graph-execution.md|g'
sed -i '' 's|docs/COGNI_BRAIN_SPEC\.md|docs/spec/cogni-brain.md|g'
# --- 11 refs ---
sed -i '' 's|docs/CHAIN_CONFIG\.md|docs/spec/chain-config.md|g'
# --- 10 refs ---
sed -i '' 's|docs/TOOL_USE_SPEC\.md|docs/spec/tool-use.md|g'
sed -i '' 's|docs/STYLE\.md|docs/spec/style.md|g'
# --- 9 refs ---
sed -i '' 's|docs/OBSERVABILITY\.md|docs/spec/observability.md|g'
sed -i '' 's|docs/FEATURE_DEVELOPMENT_GUIDE\.md|docs/guides/feature-development.md|g'
sed -i '' 's|docs/AUTHENTICATION\.md|docs/spec/authentication.md|g'
# --- 8 refs ---
sed -i '' 's|docs/TEMPORAL_PATTERNS\.md|docs/spec/temporal-patterns.md|g'
sed -i '' 's|docs/LANGGRAPH_SERVER\.md|docs/spec/langgraph-server.md|g'
sed -i '' 's|docs/LANGGRAPH_AI\.md|docs/spec/langgraph-patterns.md|g'
# --- 6 refs ---
sed -i '' 's|docs/TESTING\.md|docs/guides/testing.md|g'
# --- 5 refs ---
sed -i '' 's|docs/DATABASES\.md|docs/spec/databases.md|g'
sed -i '' 's|docs/ENVIRONMENTS\.md|docs/spec/environments.md|g'
# --- 4 refs ---
sed -i '' 's|docs/CHECK_FULL\.md|docs/spec/check-full.md|g'
# --- 3 refs ---
sed -i '' 's|docs/BILLING_EVOLUTION\.md|docs/spec/billing-evolution.md|g'
# --- 2 refs ---
sed -i '' 's|docs/ERROR_HANDLING_ARCHITECTURE\.md|docs/spec/error-handling.md|g'
# --- remaining (0-2 refs each) ---
sed -i '' 's|docs/ACCOUNTS_API_KEY_ENDPOINTS\.md|docs/spec/accounts-api-endpoints.md|g'
sed -i '' 's|docs/ACCOUNTS_DESIGN\.md|docs/spec/accounts-design.md|g'
sed -i '' 's|docs/AGENT_DEVELOPMENT_GUIDE\.md|docs/guides/agent-development.md|g'
sed -i '' 's|docs/AGENT_DISCOVERY\.md|docs/spec/agent-discovery.md|g'
sed -i '' 's|docs/AGENT_REGISTRY_SPEC\.md|docs/spec/agent-registry.md|g'
sed -i '' 's|docs/AGENTS_CONTEXT\.md|docs/guides/agents-context.md|g'
sed -i '' 's|docs/AI_EVALS\.md|docs/spec/ai-evals.md|g'
sed -i '' 's|docs/AI_SETUP_SPEC\.md|docs/spec/ai-setup.md|g'
sed -i '' 's|docs/ALLOY_LOKI_SETUP\.md|docs/guides/alloy-loki-setup.md|g'
sed -i '' 's|docs/BUILD_ARCHITECTURE\.md|docs/spec/build-architecture.md|g'
sed -i '' 's|docs/CHAIN_ACTION_FLOW_UI_SPEC\.md|docs/spec/chain-action-flow-ui.md|g'
sed -i '' 's|docs/CI-CD\.md|docs/spec/ci-cd.md|g'
sed -i '' 's|docs/CLAUDE_SDK_ADAPTER_SPEC\.md|docs/spec/claude-sdk-adapter.md|g'
sed -i '' 's|docs/CRED_LICENSING_POLICY_SPEC\.md|docs/spec/cred-licensing-policy.md|g'
sed -i '' 's|docs/DAO_ENFORCEMENT\.md|docs/spec/dao-enforcement.md|g'
sed -i '' 's|docs/DATABASE_URL_ALIGNMENT_SPEC\.md|docs/spec/database-url-alignment.md|g'
sed -i '' 's|docs/EXTERNAL_EXECUTOR_BILLING\.md|docs/spec/external-executor-billing.md|g'
sed -i '' 's|docs/GIT_SYNC_REPO_MOUNT\.md|docs/spec/git-sync-repo-mount.md|g'
sed -i '' 's|docs/GOV_DATA_COLLECTORS\.md|docs/spec/gov-data-collectors.md|g'
sed -i '' 's|docs/HUMAN_IN_THE_LOOP\.md|docs/spec/human-in-the-loop.md|g'
sed -i '' 's|docs/INTEGRATION_WALLETS_CREDITS\.md|docs/guides/wallet-auth-setup.md|g'
sed -i '' 's|docs/METRICS_OBSERVABILITY\.md|docs/spec/public-analytics.md|g'
sed -i '' 's|docs/MODEL_SELECTION\.md|docs/spec/model-selection.md|g'
sed -i '' 's|docs/N8N_ADAPTER_SPEC\.md|docs/spec/n8n-adapter.md|g'
sed -i '' 's|docs/NEW_PACKAGES\.md|docs/guides/new-packages.md|g'
sed -i '' 's|docs/NODE_CI_CD_CONTRACT\.md|docs/spec/node-ci-cd-contract.md|g'
sed -i '' 's|docs/NODE_VS_OPERATOR_CONTRACT\.md|docs/spec/node-operator-contract.md|g'
sed -i '' 's|docs/OBSERVABILITY_REQUIRED_SPEC\.md|docs/spec/observability-requirements.md|g'
sed -i '' 's|docs/OPENCLAW_SANDBOX_CONTROLS\.md|docs/spec/openclaw-sandbox-controls.md|g'
sed -i '' 's|docs/OPENCLAW_SANDBOX_SPEC\.md|docs/spec/openclaw-sandbox-spec.md|g'
sed -i '' 's|docs/PROMPT_REGISTRY_SPEC\.md|docs/spec/prompt-registry.md|g'
sed -i '' 's|docs/RBAC_SPEC\.md|docs/spec/rbac.md|g'
sed -i '' 's|docs/RUNTIME_POLICY\.md|docs/spec/runtime-policy.md|g'
sed -i '' 's|docs/SANDBOX_SCALING\.md|docs/spec/sandbox-scaling.md|g'
sed -i '' 's|docs/SERVICES_ARCHITECTURE\.md|docs/spec/services-architecture.md|g'
sed -i '' 's|docs/SETUP\.md|docs/guides/developer-setup.md|g'
sed -i '' 's|docs/SOURCECRED\.md|docs/spec/sourcecred.md|g'
sed -i '' 's|docs/SOURCECRED_CONFIG_RATIONALE\.md|docs/spec/sourcecred-config-rationale.md|g'
sed -i '' 's|docs/SYSTEM_TENANT_DESIGN\.md|docs/spec/system-tenant.md|g'
sed -i '' 's|docs/SYSTEM_TEST_ARCHITECTURE\.md|docs/spec/system-test-architecture.md|g'
sed -i '' 's|docs/TENANT_CONNECTIONS_SPEC\.md|docs/spec/tenant-connections.md|g'
sed -i '' 's|docs/TOOLS_AUTHORING\.md|docs/guides/tools-authoring.md|g'
sed -i '' 's|docs/UNIFIED_GRAPH_LAUNCH_SPEC\.md|docs/spec/unified-graph-launch.md|g'
sed -i '' 's|docs/features/HEALTH_PROBES\.md|docs/spec/health-probes.md|g'
```

**Exclusions (need manual review, not mechanical replace):**

| Old path                                    | Why manual                                                       | Refs |
| ------------------------------------------- | ---------------------------------------------------------------- | ---- |
| `docs/PAYMENTS_FRONTEND_DESIGN.md`          | Obsolete/deleted — remove link or replace with nearest spec      | 21   |
| `docs/DEPAY_PAYMENTS.md`                    | Archived — remove or redirect                                    | 17   |
| `docs/CHAIN_DEPLOYMENT_TECH_DEBT.md`        | Roadmap-only → `work/projects/proj.chain-deployment-refactor.md` | 10   |
| `docs/LINTING_RULES.md`                     | Snapshot → `docs/research/linting-rules.md`                      | 7    |
| `docs/REPO_STATE.md`                        | Snapshot → `docs/research/REPO_STATE.md` (still in research/)    | 8    |
| `docs/CICD_SERVICES_ROADMAP.md`             | Roadmap-only → `work/projects/proj.cicd-services-gitops.md`      | ~2   |
| `docs/SERVICES_MIGRATION.md`                | Roadmap-only → `work/projects/proj.cicd-services-gitops.md`      | ~1   |
| `docs/CACHING.md`                           | Roadmap-only → `work/projects/proj.performance-efficiency.md`    | ~1   |
| `docs/PROPOSAL_LAUNCHER.md`                 | Roadmap-only → `work/projects/proj.web3-gov-mvp.md`              | ~1   |
| `docs/ERROR_HANDLING_IMPROVEMENT_DESIGN.md` | Roadmap-only → `work/projects/proj.observability-hardening.md`   | ~1   |

### Phase 1: AGENTS.md files (~160 refs, highest value)

AGENTS.md files are the primary navigation tool for developers and AI agents. These are the most impactful refs to fix.

**Steps:**

1. `grep -r 'docs/[A-Z]' --include='AGENTS.md' -l` — list all AGENTS.md files with stale refs
2. For each file, read it and update all `docs/UPPER_CASE.md` links to new paths
3. **Relative paths matter:** An AGENTS.md at `src/adapters/server/sandbox/AGENTS.md` references `../../../../docs/ARCHITECTURE.md` — the new path is `../../../../docs/spec/architecture.md` (same depth, just add `spec/` and lowercase)
4. Commit: `docs(refs): update AGENTS.md doc references` — one commit for all AGENTS.md files

**Pattern:** Most AGENTS.md refs look like:

```markdown
- [Architecture](../../docs/ARCHITECTURE.md)
```

Replace with:

```markdown
- [Architecture](../../docs/spec/architecture.md)
```

### Phase 2: TypeScript doc-header comments (~220 refs)

These are `* Links:` comments in the file-level JSDoc at the top of `.ts` files.

**Steps:**

1. `grep -r 'docs/[A-Z]' --include='*.ts' --include='*.tsx' -l` — list files
2. These are always in the format `* Links: docs/SCHEDULER_SPEC.md, docs/TEMPORAL_PATTERNS.md`
3. Replace old paths with new. These are repo-root-relative (no `../`), so: `docs/SCHEDULER_SPEC.md` → `docs/spec/scheduler.md`
4. Commit: `docs(refs): update TypeScript doc-header links`

**Pattern:**

```typescript
* Links: docs/SCHEDULER_SPEC.md, docs/TEMPORAL_PATTERNS.md
```

Replace with:

```typescript
* Links: docs/spec/scheduler.md, docs/spec/temporal-patterns.md
```

### Phase 3: Markdown cross-references (~150 refs)

Specs, initiatives, guides, and research docs referencing each other.

**Steps:**

1. `grep -r 'docs/[A-Z]' --include='*.md' -l` — list files (exclude tracker itself)
2. For each file, update refs. Watch out for:
   - **Relative paths** differ by directory depth (spec referencing another spec is `./`, initiative referencing spec is `../../docs/spec/`)
   - **`> Source:` attribution lines** in initiatives — these reference the OLD path intentionally as provenance. **Leave these alone.**
   - **Deleted/obsolete docs** — remove the link or replace with the nearest living doc
3. Commit: `docs(refs): update markdown cross-references`

### Phase 4: Config and scripts (~30 refs)

ESLint configs, shell scripts, toml files.

1. `grep -r 'docs/[A-Z]' --include='*.mjs' --include='*.sh' --include='*.toml' --include='*.yaml' -l`
2. Update paths
3. Commit: `docs(refs): update config and script doc references`

### Phase 5: Verify and mark tracker

1. Run `pnpm check:docs` — must pass
2. Run `grep -r 'docs/[A-Z][A-Z_]*\.md' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.mjs' --include='AGENTS.md'` — should return zero actionable results
3. Mark `[x]` in the Refs column for every row in the tracker
4. Commit: `docs(refs): mark all tracker refs as done`

## Battle-Tested Process (per doc)

This workflow was developed through 8 doc migrations. Follow it exactly.

### Step 1: Check the migration tracker

Read `wi.docs-migration-tracker.md` for the doc's row. Note:

- **Spec column** → primary target is `docs/spec/{value}`
- **Ini column** → if present, this is a multi-destination doc
- **Guide column** → if present, procedural content went here

For **multi-destination docs**: code refs (Links comments, AGENTS.md) → spec. Roadmap/TODO refs → ini. Setup/howto refs → guide. Most refs go to spec.

### Step 2: Grep broadly

Search for ALL patterns of the old name — not just `docs/OLD.md`:

```bash
# In the worktree:
grep -rn 'OLD_NAME\.md' --include='*.{md,ts,tsx,mjs,sh,toml,yaml}' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist
```

This catches:

- `docs/OLD_NAME.md` — repo-root-relative (most common)
- `(OLD_NAME.md)` — bare relative within docs/spec/ (same-dir ref)
- `(../OLD_NAME.md)` — relative from docs/archive/, docs/research/
- `(./OLD_NAME.md)` — relative from docs/research/

### Step 3: Run targeted sed replacements

Three sed passes per doc:

```bash
# 1. Repo-root-relative paths (covers Links: comments, most AGENTS.md)
# EXCLUDE: ini files with > Source: lines, tracker, sweep doc
find . -type f \( -name '*.md' -o -name '*.ts' -o -name '*.tsx' \
  -o -name '*.mjs' -o -name '*.toml' -o -name '*.sh' -o -name '*.yaml' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  ! -path '*/ini.RELEVANT_INI.md' \
  -exec sed -i '' 's|docs/OLD_NAME\.md|docs/spec/new-name.md|g' {} +

# 2. Internal relative paths within docs/ subdirs
find ./docs/spec -name '*.md' -exec sed -i '' \
  's|(OLD_NAME\.md)|(new-name.md)|g' {} +
find ./docs/archive -name '*.md' -exec sed -i '' \
  -e 's|(OLD_NAME\.md)|(../spec/new-name.md)|g' \
  -e 's|(../OLD_NAME\.md)|(../spec/new-name.md)|g' {} +
find ./docs/research -name '*.md' -exec sed -i '' \
  -e 's|(../OLD_NAME\.md)|(../spec/new-name.md)|g' \
  -e 's|(./OLD_NAME\.md)|(../spec/new-name.md)|g' {} +

# 3. Fix link titles (markdown link text)
find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[OLD_NAME\.md\]|[Human Readable Title]|g' {} +
```

### Step 4: Verify

```bash
grep -rn 'OLD_NAME\.md' --include='*.{md,ts,tsx,mjs,sh,toml,yaml}' \
  --exclude-dir=node_modules | grep -v 'wi.refs-sweep' | grep -v 'wi.docs-migration-tracker'
```

Remaining matches should only be:

- `> Source:` provenance lines in initiatives (correct — don't touch)
- Prose mentions in code comments (`Per OLD_NAME.md:`) — acceptable to leave
- Archive migration tables (`DOCS_ORGANIZATION_PLAN.md`) — historical, leave
- Research doc analysis prose — historical, leave

### Step 5: Stage and commit

```bash
git add -A  # ONLY safe in an isolated worktree
git commit -m "docs(refs): update old-name references to docs/spec/new-name.md"
```

### Step 6: Mark tracker

In `wi.docs-migration-tracker.md`, change `[ ]` to `[x]` in the Refs column for this doc.

## Invariants

1. **ONE_COMMIT_PER_DOC** — Each doc gets its own commit. Never batch multiple docs.
2. **PRESERVE_SOURCE_LINES** — `> Source: docs/OLD.md` lines in initiatives are provenance. Exclude the ini file from sed by path.
3. **FIX_LINK_TITLES** — `[OLD_NAME.md](...)` must become `[Human Title](...)`. The sed title pass handles this.
4. **FIX_INTERNAL_REFS** — Files in `docs/spec/` use bare `(OLD.md)` refs (same dir). Files in `docs/archive/` and `docs/research/` use `(../OLD.md)`. These need separate sed passes with correct relative targets.
5. **MULTI_DEST_CONTEXT** — For docs split to spec+ini+guide, decide per-ref: code/Links → spec, roadmap → ini, howto → guide. Default to spec.
6. **USE_WORKTREE** — Work in `/Users/derek/dev/cogni-template-refs-sweep` (branch `refs-sweep-worktree`). Another dev works in the main tree. Use `git add -A` only in the worktree.
7. **LOWERCASE_COMMIT_SUBJECT** — commitlint rejects uppercase in subject. Use `docs(refs): update lower-case-name references to docs/spec/new.md`.
8. **SKIP_PROSE_MENTIONS** — Code comments like `Per OLD_NAME.md:` are acceptable to leave. They don't break navigation. Focus on link paths and `* Links:` comments.
9. **SKIP_ARCHIVE_TABLES** — `DOCS_ORGANIZATION_PLAN.md` has a migration mapping table referencing old names. This is historical — don't touch.

## Validation

After all docs are done, this command should return zero results (excluding Source lines, tracker, and sweep doc):

```bash
grep -rn 'docs/[A-Z][A-Z_]*\.md' \
  --include='*.ts' --include='*.tsx' --include='*.md' \
  --include='*.mjs' --include='*.sh' --include='*.toml' \
  --include='*.yaml' --include='AGENTS.md' \
  --exclude-dir=node_modules \
  | grep -v 'Source:' \
  | grep -v 'wi.docs-migration-tracker' \
  | grep -v 'wi.refs-sweep'
```

Additionally: `pnpm check:docs` must pass after every commit.
