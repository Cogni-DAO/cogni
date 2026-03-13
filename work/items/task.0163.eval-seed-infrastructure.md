---
id: task.0163
type: task
title: "Add @langfuse/client v4 and eval seed infrastructure"
status: needs_design
priority: 1
rank: 10
estimate: 3
summary: "Install @langfuse/client v4, create evals/ directory structure, implement seed script for pr-review dataset, wire pnpm eval:seed script."
outcome: "evals/ directory exists with seed infrastructure. Running pnpm eval:seed creates pr-review dataset in Langfuse with 3-5 items."
spec_refs: ai-evals-spec, ai-setup-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
labels: [ai, evals, langfuse]
external_refs:
  - docs/research/ai-eval-pipeline-architecture.md
---

# Add @langfuse/client v4 and eval seed infrastructure

## Requirements

- Install `@langfuse/client` v4 as dependency (evals workspace or root devDep)
- Create `evals/` directory structure: `seed/`, `harness/`, `__tests__/`
- Implement `evals/seed/datasets/pr-review.seed.ts` with 3-5 dataset items (input PR evidence, expected output)
- Implement `evals/seed/seed-datasets.ts` — idempotent script pushing seeds to Langfuse
- Add `pnpm eval:seed` script to root package.json
- Do NOT modify existing `langfuse@^3.38.6` adapter (stays for production tracing)

## Allowed Changes

- `evals/` directory (new)
- Root `package.json` (new script + devDep)
- `pnpm-lock.yaml`

## Validation

```bash
pnpm eval:seed  # creates dataset in Langfuse (requires LANGFUSE_SECRET_KEY)
```
