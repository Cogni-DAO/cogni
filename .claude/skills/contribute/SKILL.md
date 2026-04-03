---
name: contribute
description: "Contribute to a Cogni node repo as an AI agent. Use this skill when you need to: find available tasks, claim work, implement changes, run checks, submit PRs, handle CI failures, or respond to review feedback in a Cogni monorepo. Also use when the user says 'find work', 'pick up a task', 'contribute', 'submit a PR', 'check CI status', or 'fix CI'. This skill orchestrates the full dev lifecycle from task discovery to merged PR."
---

# Contribute to Cogni

You are an AI agent contributing code to a Cogni node repository. This skill guides you through the full lifecycle: find work → understand it → implement → validate locally → push once → handle feedback.

## Prerequisites

Before starting, verify:

- `git` configured with push access (fork or direct branch)
- `gh` CLI authenticated (`gh auth status`)
- You're inside a cloned Cogni repo with `work/items/` directory
- `pnpm install` has been run

If any are missing, fix them first. Don't guess — run the checks.

## The Lifecycle

### Phase 1: Find Work

```bash
pnpm cogni-contribute tasks --node poly --status needs_implement
pnpm cogni-contribute tasks                    # all actionable items
```

Before claiming, **read the task thoroughly**:

1. Read the work item file: `work/items/<task_id>.<slug>.md`
2. Read every file in `spec_refs` — these are your contracts
3. Read `CLAUDE.md` at repo root — the operating rules
4. Read `AGENTS.md` in every directory you'll touch

Understanding the task is more important than speed. A wrong implementation wastes a full CI cycle (20+ min).

### Phase 2: Claim and Branch

```bash
pnpm cogni-contribute claim task.0264
git checkout -b feat/task.0264-<slug> origin/canary
```

The CLI sets assignee + branch in frontmatter. You handle git. If the task is already claimed, pick a different one.

### Phase 3: Implement

Follow the work item's Plan section. Key principles:

1. **Stay scoped** — only touch files in Allowed Changes
2. **Reuse first** — search `packages/` before writing new code
3. **Follow patterns** — read neighboring files, match conventions
4. **Hex architecture** — `app → features → ports → core`, adapters implement ports from outside

Run `pnpm check:fast` often during iteration. It auto-fixes lint and format.

### Phase 4: Validate Locally — This Is the Gate

```bash
pnpm check
```

This runs everything: packages build → typecheck → lint → format → arch checks → docs → tests. **Every check must pass before you push.** The pre-push hook runs `check:fast` and will reject your push if it fails. Never use `--no-verify` — fix the code.

Common fixes:

- `pnpm lint:fix` — auto-fixes most lint errors
- `pnpm format` — auto-fixes all formatting
- Arch violations → read `.dependency-cruiser.cjs` for boundary rules
- `pnpm check:docs` errors → the message tells you the exact file and field

### Phase 5: Push and PR

One push. Make it count. Each push to canary triggers a full image build + Argo rollout.

```bash
git push -u origin feat/task.0264-<slug>
gh pr create --base canary --title "feat(task.0264): description" --body "Work Item: task.0264"
```

**Target: `canary`.** Not staging, not main. Canary is the AI testing gate. Staging is human preview. Main is production.

Commit message format: `type(scope): lowercase description` under 100 chars. commitlint rejects sentence-case.

### Phase 6: Monitor CI + Review

```bash
pnpm cogni-contribute status task.0264
gh pr checks <pr-number>                # detailed check status
gh run view <run-id> --log-failed       # CI failure logs
```

CI stages: static (~3 min) → unit (~3 min) → component (~3 min) → stack-test (~15 min).

If CI fails: read the logs, fix locally, run `pnpm check:fast`, push. CI re-runs automatically.

If review requests changes: read the PR comments, fix, push. After 3 rejections, the task auto-blocks for human escalation — that means your approach has a fundamental issue, not a fixup.

### Phase 7: After Merge

The CD pipeline handles everything:

1. **PR merges to `canary`** → CI builds images → Argo deploys to canary environment
2. **Human promotes to `staging`** → preview for approval
3. **Human merges to `main`** → production

You're done after merge to canary.

## How Canary Deployment Works

Every push to canary triggers: image build → GHCR push → digest promotion commit → Argo sync → pods rolling update (~30s after promotion). Argo reconciles every 30s on canary.

All infra changes go through git. Argo is the only deployer. If Argo doesn't have it, it doesn't exist on the cluster. Never manually patch k8s resources — Argo overwrites them on next sync.

Test with the browser (playwright), not curl. `/livez` returning 200 doesn't mean the app works — client-side hydration crashes are invisible to health checks.

Monitor with Grafana MCP for logs and metrics, not SSH.

## Architecture Quick Reference

```
nodes/operator/app/     # Operator node (Next.js)
nodes/poly/app/         # Poly node (Next.js)
nodes/resy/app/         # Resy node (Next.js)
packages/               # Shared pure TS libraries (@cogni/*)
services/               # Deployable workers (scheduler-worker)
work/items/             # Work items (YAML frontmatter markdown)
docs/spec/              # Specs (as-built contracts, invariants)
infra/k8s/              # Kubernetes manifests (Argo CD syncs these)
infra/catalog/          # One YAML per deployed component
```

**Hex layers**: `core` → `ports` → `features` → `app`. Adapters implement ports from outside. Dependencies always point inward.

**Contracts are truth**: API shapes in `src/contracts/*.contract.ts` (Zod). Everything derives from them.

**Packages are pure**: No env, no lifecycle, no framework deps. Never import `src/` from `packages/`.

**Images are per-node**: poly builds poly, resy builds resy. Don't assume all nodes share one image.

## Good Contributions

Small, atomic features with a clear validation checklist. Every PR should:

1. **Do one thing** — if you can't describe it in one commit message, it's too big
2. **Include an e2e validation plan** — what should a human click on the staging preview to verify this works? Write it in the PR description
3. **Strengthen the system** — add tests, tighten contracts, improve error messages. Leave the codebase more reliable than you found it
4. **Build locally, validate locally, push once** — `pnpm check:fast` during iteration, `pnpm check` before push, one clean push that triggers one deploy

## What Will Get Your PR Rejected

**Process violations:**

- Using `--no-verify` to bypass hooks — ever, for any reason. Fix the code instead
- Skipping `pnpm check` before push — every CI failure you cause wastes 20 minutes
- Multiple fixup pushes instead of squashing — each push = full image build + deploy cycle

**Quality regressions:**

- PRs that loosen requirements: weakening arch checks, switching `/readyz` to `/livez`, removing test assertions, widening type signatures from specific to `any`
- Deleting or disabling tests to make CI pass
- Adding `biome-ignore` or `eslint-disable` without a linked issue explaining why

**Scope violations:**

- Touching files outside your task's scope
- Adding features or "improvements" beyond what was asked
- Committing `.env` files, credentials, or secrets

**Infra violations:**

- Manual k8s patches (Argo overwrites them on next sync)
- Sentence-case commit messages (`Description` instead of `description`)
- PRing to `staging` or `main` (agents PR to `canary`)
