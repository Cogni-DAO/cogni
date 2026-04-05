---
id: spec.release-control-plane
type: spec
title: Release Control Plane — Unified Candidate Promotion
status: draft
trust: draft
summary: Temporal-driven release state machine replacing workflow_run chaining. Two models — ReleaseCandidate (many) and EnvironmentController (scarce) — with policy-gated preview and human-gated prod.
read_when: Understanding release promotion, deploying to preview/prod, building release UI, or debugging promotion state
owner: derekg1729
created: 2026-04-05
initiative: proj.cicd-services-gitops
---

# Release Control Plane

> Unified candidate promotion replacing workflow_run chaining and split code/image tracks.

## Problem

The current pipeline has three structural faults:

1. **Split-brain risk.** Code promotion (branch merges) and image promotion (digest updates) are two independent tracks. A release branch cut from `staging` can contain different code than the canary images deployed to that environment. "Green" means "deploy finished," not "code matches images."

2. **Noise at scale.** With 1,000+ canary commits/day from AI agents, auto-following every green SHA to preview resets review sessions, drowns humans in noise, and makes "green" statistically meaningless. Preview is a scarce review lane, not a canary mirror.

3. **Fragile chaining.** `workflow_run` only fires when the workflow file exists on the default branch, cannot chain beyond 3 levels, and conflates CI orchestration with release policy. The relay race (`build-multi-node` → `promote-and-deploy` → `e2e` → `promote-to-staging`) is brittle and opaque.

## Design Principles

- **Candidates are many; environments are scarce.** Not every green SHA becomes a preview. Policy decides.
- **One candidate object.** SHA + digests travel together. No separate code/image tracks.
- **GH Actions emits facts.** Temporal + app DB own the state machine.
- **Build once, promote digests.** No rebuilds between environments.
- **Staging is an environment, not a code branch.** Kill `staging` as a long-lived merge target for feature branches.
- **Late, minimal release branches.** Cut from canary at the exact SHA running in preview, only when promoting to main.

## Branch Model (Target)

```
feat/* ──PR──▶ canary ──release/SHA──▶ main
                 │
                 │  (image promotion only, no code merge)
                 ▼
         deploy/canary    deploy/preview    deploy/production
         (bot commits)    (bot commits)     (bot commits)
```

**Eliminated:** `staging` as a code branch. Feature PRs target `canary`. Release branches cut from canary.

**Preserved:** `deploy/*` orphan branches for GitOps (Argo CD watches these). `main` as production-gated code.

**Default branch:** `canary` becomes the default branch (enables `workflow_run` triggers, PR targets).

## Architecture

### Two State Machines

#### 1. ReleaseCandidate(SHA)

Tracks a single commit through the promotion pipeline. Many candidates exist simultaneously; most are superseded.

```
discovered ──▶ building ──▶ built ──▶ canary_deploying ──▶ canary_healthy
     │              │                        │                    │
     │              ▼                        ▼                    ▼
     │          build_failed            deploy_failed       canary_e2e_pass
     │                                                           │
     │                                                           ▼
     │                                                    eligible_for_preview
     │                                                           │
     │    (policy gate: debounce + preview free + no active review)
     │                                                           │
     │                                                           ▼
     │                                                    preview_deploying
     │                                                           │
     │                                                           ▼
     │                                                    preview_ready
     │                                                           │
     │                                      (human approval gate)
     │                                                           │
     │                                                           ▼
     │                                                    approved_for_prod
     │                                                           │
     │                                                           ▼
     │                                                    prod_deploying
     │                                                           │
     │                                                           ▼
     │                                                    prod_verified ✅
     │
     └──────────────▶ superseded  (newer candidate reached same stage)
                      failed      (any stage failure)
                      rolled_back (manual intervention)
```

**Key field: the candidate object.**

```typescript
interface ReleaseCandidate {
  sha: string; // Git commit SHA (identity)
  digests: Record<string, string>; // app → sha256 digest (operator, poly, resy, scheduler-worker)
  status: ReleaseCandidateStatus;
  discoveredAt: Date;
  buildRunId?: string; // GH Actions run ID
  buildCompletedAt?: Date;
  canaryDeployedAt?: Date;
  canaryE2ePassedAt?: Date;
  previewSelectedAt?: Date;
  previewDeployedAt?: Date;
  approvedBy?: string; // Human who approved
  approvedAt?: Date;
  prodDeployedAt?: Date;
  prodVerifiedAt?: Date;
  supersededBy?: string; // SHA that replaced this candidate
  failureReason?: string;
}
```

#### 2. EnvironmentController(env)

Tracks each scarce environment. One controller per environment (canary, preview, prod).

```
idle ──▶ selecting_candidate ──▶ deploying ──▶ verifying ──▶ stable
  ▲                                                            │
  │                                                            ▼
  └────────────────────────────── rollback ◀──────────── verification_failed
```

**Key field: environment occupancy.**

```typescript
interface EnvironmentState {
  env: "canary" | "preview" | "production";
  status: EnvironmentStatus;
  currentSha: string | null; // SHA currently deployed
  currentDigests: Record<string, string>;
  lockedBy?: string; // "system:auto" | "human:derekg1729"
  deployStartedAt?: Date;
  lastStableAt?: Date;
  lastRollbackAt?: Date;
}
```

### Promotion Policy

#### Canary (auto, every green build)

- Every push to `canary` that passes build → auto-deploy to canary environment
- Concurrency: cancel-in-progress (latest SHA wins)
- Deploy method: direct bot commit to `deploy/canary` (no PRs)

#### Preview (policy-gated, debounced)

**Rule:** Promote the latest `eligible_for_preview` candidate when ALL of:

1. Preview environment is `idle` or `stable` (not mid-deploy or mid-review)
2. No human review is in progress (no `approved_for_prod` candidate pending)
3. Candidate has survived a **soak window** (configurable, default: 15 minutes since `canary_e2e_pass`)
4. **OR** manual expedite requested (operator clicks "promote now")

**Effect:** Most candidates are `superseded` before reaching preview. This is correct — preview is for snapshots, not continuous mirroring.

**Deploy method:** Direct bot commit to `deploy/preview` (no PRs)

#### Production (human-gated)

**Rule:** Promote only when:

1. Exact SHA+digests currently running in preview have been explicitly approved
2. GH Environment protection rule satisfied (approval on `production` environment)
3. Release branch `release/{date}-{sha8}` created from canary at the approved SHA
4. PR opened: `release/*` → `main`

**This is the only human gate in the entire pipeline.**

**Deploy method:** Merge release PR → `main` push → build-prod (verify images exist) → direct bot commit to `deploy/production`

### Where the State Machine Lives

```
┌─────────────────────────────────────────────────┐
│              Temporal (Control Plane)            │
│                                                 │
│  ReleaseCandidateWorkflow(sha)                  │
│    - Long-running, one per candidate            │
│    - Receives signals: build_complete,          │
│      deploy_complete, e2e_pass, approval        │
│    - Calls activities for deploy-branch         │
│      updates, GH API, health checks            │
│                                                 │
│  EnvironmentControllerWorkflow(env)             │
│    - Long-running, one per environment          │
│    - Receives signals: deploy_requested,        │
│      verification_complete, rollback            │
│    - Selects candidates via policy query        │
│    - Coordinates with candidate workflows       │
│                                                 │
│  PromotionPolicyWorkflow                        │
│    - Periodic (every 1 min): checks eligible    │
│      candidates, soak windows, env availability │
│    - Signals EnvironmentController to deploy    │
│                                                 │
├─────────────────────────────────────────────────┤
│              App DB (State Store)                │
│                                                 │
│  release_candidates   - Append-only candidate   │
│  candidate_transitions - State change log       │
│  environment_state    - Current env occupancy   │
│  promotion_decisions  - Policy audit trail      │
│  rollback_events      - Rollback history        │
│                                                 │
├─────────────────────────────────────────────────┤
│          GH Actions (Fact Emitter)              │
│                                                 │
│  Orchestrator workflow (on push to canary):     │
│    1. change-detection job (affected nodes)     │
│    2. build-nodes (matrix, affected only)       │
│    3. POST /api/v1/release/build-complete       │
│                                                 │
│  Deploy-branch updates: bot commits via         │
│    Temporal activity (not GH workflow)          │
│                                                 │
│  Health verification: Temporal activity polls   │
│    /readyz, not GH Actions step                 │
│                                                 │
│  E2E tests: Temporal activity triggers          │
│    Playwright via GH workflow_dispatch,         │
│    receives result via webhook callback         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Fact Ingestion (GH Actions → Control Plane)

Two complementary paths — webhook for speed, poll for durability:

1. **GitHub webhook** (`workflow_run` event) → operator app webhook route → normalize to `ActivityEvent` → signal `ReleaseCandidateWorkflow`
2. **Loki structured logs** (already emitted by CI telemetry) → periodic Temporal poll activity as fallback

**Webhook payload (normalized to ActivityEvent):**

```typescript
// source: "github-actions"
// eventType: "workflow_run.completed"
// metadata: { workflow: "Build Multi-Node", conclusion: "success", sha, run_id, digests }
```

This reuses the existing `DataSourceRegistration` + `WebhookNormalizer` pattern from `@cogni/ingestion-core`.

## Database Schema

New tables in `@cogni/db-schema`:

```sql
-- Release candidates (append-only identity)
CREATE TABLE release_candidates (
  sha TEXT PRIMARY KEY,
  digests JSONB NOT NULL,                -- {"operator": "sha256:...", "poly": "sha256:...", ...}
  status TEXT NOT NULL DEFAULT 'discovered',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_run_id TEXT,
  superseded_by TEXT REFERENCES release_candidates(sha),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Candidate state transitions (append-only audit log)
CREATE TABLE candidate_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha TEXT NOT NULL REFERENCES release_candidates(sha),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  environment TEXT,                      -- Which env this transition relates to (nullable)
  actor TEXT,                            -- "system:temporal" | "human:derekg1729"
  metadata JSONB,                        -- Run IDs, digests, error details
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX candidate_transitions_sha_idx ON candidate_transitions(sha);

-- Environment state (one row per env, upserted)
CREATE TABLE environment_state (
  env TEXT PRIMARY KEY,                  -- 'canary' | 'preview' | 'production'
  status TEXT NOT NULL DEFAULT 'idle',
  current_sha TEXT REFERENCES release_candidates(sha),
  current_digests JSONB,
  locked_by TEXT,
  deploy_started_at TIMESTAMPTZ,
  last_stable_at TIMESTAMPTZ,
  last_rollback_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Promotion decisions (append-only policy audit)
CREATE TABLE promotion_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha TEXT NOT NULL REFERENCES release_candidates(sha),
  target_env TEXT NOT NULL,
  decision TEXT NOT NULL,                -- 'promoted' | 'superseded' | 'debounce_wait' | 'env_busy' | 'manual_expedite'
  reason TEXT,
  actor TEXT NOT NULL,                   -- "system:policy" | "human:derekg1729"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Temporal Workflow Definitions

### ReleaseCandidateWorkflow

```typescript
// Package: @cogni/temporal-workflows
// One workflow per SHA. Long-running (hours to days for slow prod approval).

interface ReleaseCandidateInput {
  sha: string;
  digests: Record<string, string>;
  buildRunId: string;
}

// Signals
type BuildCompleteSignal = {
  conclusion: "success" | "failure";
  digests: Record<string, string>;
  runId: string;
};
type DeployCompleteSignal = { env: string; success: boolean; error?: string };
type E2eCompleteSignal = { env: string; passed: boolean; runId: string };
type ApprovalSignal = { approvedBy: string; targetEnv: "production" };
type SupersededSignal = { by: string };

// Workflow ID: `release-candidate:${sha}`
// Deterministic — safe for idempotent re-creation.
```

### EnvironmentControllerWorkflow

Subsumes promotion policy — the controller self-selects candidates via a timer-based loop, avoiding a third cooperating workflow.

```typescript
// One workflow per environment. Very long-running (effectively permanent, use continue-as-new).
// Contains promotion policy as an internal timer loop:
//   - Every `selectionIntervalMs` (default 60s), query for latest eligible candidate
//   - If candidate exists, soak window passed, and no active review → deploy
//   - This eliminates the need for a separate PromotionPolicyWorkflow

interface EnvironmentControllerInput {
  env: "canary" | "preview" | "production";
  selectionIntervalMs?: number; // Default 60_000 (1 min)
  soakWindowMinutes?: number; // Default 15 (preview), 0 (canary)
}

// Signals
type DeployRequestSignal = {
  sha: string;
  digests: Record<string, string>;
  expedite?: boolean;
};
type VerificationCompleteSignal = { success: boolean; error?: string };
type RollbackSignal = { reason: string; actor: string };

// Workflow ID: `env-controller:${env}`
// Uses continue-as-new after each stable→idle cycle to avoid history growth.
```

### Activities (new in `@cogni/temporal-workflows/activity-types.ts`)

```typescript
interface ReleaseActivities {
  // Deploy-branch management
  updateDeployBranch(
    env: string,
    sha: string,
    digests: Record<string, string>
  ): Promise<void>;

  // GH API interactions
  triggerE2eWorkflow(env: string, sha: string): Promise<{ runId: string }>;
  createReleaseBranch(sha: string): Promise<{ branch: string }>;
  createReleasePr(
    branch: string,
    sha: string
  ): Promise<{ prNumber: number; prUrl: string }>;

  // Health verification
  verifyEnvironmentHealth(
    env: string,
    domain: string
  ): Promise<{ healthy: boolean; error?: string }>;

  // State persistence
  upsertCandidate(candidate: ReleaseCandidate): Promise<void>;
  recordTransition(
    sha: string,
    from: string,
    to: string,
    metadata?: Record<string, unknown>
  ): Promise<void>;
  updateEnvironmentState(
    env: string,
    state: Partial<EnvironmentState>
  ): Promise<void>;
  recordPromotionDecision(
    sha: string,
    env: string,
    decision: string,
    reason: string
  ): Promise<void>;

  // Policy queries
  getLatestEligibleCandidate(
    minSoakMinutes: number
  ): Promise<ReleaseCandidate | null>;
  isEnvironmentFree(env: string): Promise<boolean>;

  // Supersession
  supersedeCandidates(beforeSha: string, stage: string): Promise<number>;
}
```

## GH Actions Changes

### Kill

- `staging-preview.yml` — replaced entirely
- `workflow_run` chaining between `build-multi-node` → `promote-and-deploy` → `e2e`
- `e2e.yml` `promote-to-staging` and `promote-release` jobs
- Auto-PR creation to deploy branches

### Keep (simplified)

- **`ci.yaml`** — PR checks, unchanged
- **`build-multi-node.yml`** — build + push to GHCR, then POST fact to control plane
- **`e2e.yml`** — stripped to pure test runner, `workflow_dispatch` only (triggered by Temporal)
- **`build-prod.yml`** → simplified to verify images exist + tag for production
- **`require-pinned-release-prs-to-main.yml`** — unchanged

### New

- **`orchestrator.yml`** (replaces the relay chain):
  ```yaml
  on:
    push:
      branches: [canary]
  jobs:
    change-detection:
      # Determine which nodes/services changed
    build:
      needs: change-detection
      uses: ./.github/workflows/_build-node.yml # reusable
      strategy:
        matrix: ${{ fromJson(needs.change-detection.outputs.matrix) }}
    notify-control-plane:
      needs: build
      if: success()
      # POST to operator /api/v1/release/build-complete
      # with { sha, digests, runId }
  ```

### Deploy-Branch Updates

Move from GH Actions to Temporal activity. The `updateDeployBranch` activity:

1. Clones deploy branch (sparse checkout)
2. Runs `promote-k8s-image.sh` (existing script, reused)
3. Commits and pushes directly (no PR for canary/preview; PR only for production if desired)

This eliminates the noisy auto-PR pattern for canary and the entire `promote-and-deploy.yml` relay.

## Visualization (App UI)

Swimlane board at `/release` (operator dashboard):

```
┌─────────────────────────────────────────────────────────────────┐
│                    Release Control Plane                         │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│   Canary     │   Preview    │  Production  │  Candidate Queue  │
│              │              │              │                   │
│  ● SHA: abc  │  ● SHA: xyz  │  ● SHA: 123  │  abc ── building  │
│  ✅ healthy  │  ✅ stable   │  ✅ verified │  def ── eligible  │
│  deployed 2m │  deployed 1h │  deployed 3d │  ghi ── superseded│
│              │              │              │  jkl ── e2e_pass  │
│  [Expedite→] │  [Approve→]  │  [Rollback]  │                   │
└──────────────┴──────────────┴──────────────┴───────────────────┘
```

Data sources (reusing existing patterns):

- `release_candidates` table → projected via API contract
- `candidate_transitions` → timeline view per candidate
- `environment_state` → swimlane headers
- `promotion_decisions` → audit trail feed

API contract: `release.status.v1.contract.ts` with standard Zod schemas.

## Credential Management

The `updateDeployBranch` activity requires git push access to `deploy/*` branches. Two options, in order of preference:

1. **GitHub App installation token** (preferred): Short-lived (1hr), scoped to `contents:write` on the single repo. The scheduler-worker refreshes via `ACTIONS_AUTOMATION_BOT_APP_ID` + private key (already used by existing CI workflows as `ACTIONS_AUTOMATION_BOT_PAT`). Activity calls `POST /app/installations/{id}/access_tokens` per invocation.

2. **Long-lived PAT** (fallback): The existing `ACTIONS_AUTOMATION_BOT_PAT` secret, mounted as a Kubernetes secret into the scheduler-worker pod. Simpler but violates least-privilege (PAT has broader scope).

**Constraint:** `deploy/*` branches should have "restrict push" to only the CI bot account. This prevents human accidents and ensures all deploy-branch changes are auditable through the control plane.

## Rollback Mechanism

Rollback means: redeploy the previous stable SHA's digests to the target environment.

1. `EnvironmentController` receives `RollbackSignal`
2. Activity queries `environment_state` for the environment's `previous_stable_sha` (tracked alongside `current_sha`)
3. Activity looks up `release_candidates` for that SHA's digests
4. Activity calls `updateDeployBranch` with the old digests (new commit, not git revert)
5. Argo CD syncs the old digests → pods roll back
6. Candidate that was running gets status `rolled_back`

**Constraint:** `environment_state` must track both `current_sha` and `previous_stable_sha`. Rollback is always one step back — cascading rollback requires manual intervention.

## Staging Decommission Checklist

Eliminating `staging` as a code branch requires updating every reference:

- `.github/workflows/*.yml` — all `branches: [staging]` triggers and `--ref staging` dispatches
- Branch protection rules — remove staging protection, ensure canary has equivalent rules
- `workflow_run` triggers — these fire from default branch only; changing default to canary handles this
- Open PRs targeting staging — close or retarget to canary
- `docs/spec/ci-cd.md` — update branch model documentation
- GitHub repo settings — change default branch from staging to canary
- 5+ stale release PRs targeting main — close, new releases will come from canary flow
- `CLAUDE.md` / `AGENTS.md` references to staging workflow

**This is a high-blast-radius migration. It should be its own task with a dedicated checklist, executed only after the pipeline is green end-to-end.**

## Invariants

- **CANDIDATE_IDENTITY**: SHA + digests are one object. No separate code/image promotion tracks.
- **BUILD_ONCE**: Images are built once on canary push. All environments receive the same digests.
- **PREVIEW_POLICY_NOT_PASS**: Preview updates on policy (soak window + env availability), not on every green canary.
- **TEMPORAL_OWNS_STATE**: GH Actions emits facts. Temporal workflows own transitions. App DB is the store.
- **ACTIONS_ARE_FACTS**: GH Actions never decides promotion. It builds, tests, and reports.
- **HUMAN_GATE_AT_PROD**: The only human approval is preview → production. Everything else is automated policy.
- **SUPERSESSION_IS_NORMAL**: Most candidates are superseded. This is correct, not a failure.
- **DEPLOY_BRANCH_DIRECT**: Canary and preview deploy-branch updates are direct bot commits, not PRs.
- **RELEASE_BRANCH_LATE**: Release branches are cut from canary at the exact SHA approved in preview. Not earlier.
- **APPEND_ONLY_AUDIT**: `candidate_transitions` and `promotion_decisions` are append-only. Full audit trail.

## Related

- [CI/CD Pipeline Flow](ci-cd.md) — current pipeline (will be updated after migration)
- [CD Pipeline E2E](cd-pipeline-e2e.md) — deploy-branch and Argo CD mechanics
- [Architecture](architecture.md) — hexagonal layering, port/adapter pattern
- [Attribution Ledger](attribution-ledger.md) — ingestion patterns reused here
