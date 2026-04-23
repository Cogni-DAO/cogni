# nodes/canary — AGENTS.md

> Scope: the Cogni Canary node. First AI-operated node in the monorepo. Sole brain is 4o-mini (with haiku/kimi/deepseek fallbacks). Must stay within `CANARY_SCOPE_FENCE`.

## What this node is

The canary is the first AI-run sovereign node in the Cogni repo. Its goal is to produce ethical revenue using cheap models (4o-mini) _before_ humans build the equivalent with expensive ones. If it succeeds, it earns its way up to Claude Haiku.

See [`proj.cogni-canary`](../../work/projects/proj.cogni-canary.md) for the full mission, roadmap, and constraints.

## Status (as of scaffold PR)

This directory is **scaffold only**. It was copied from `nodes/node-template` and surface-renamed. It is NOT yet:

- A CI build target (see `task.0338`)
- Wired into k8s or Argo (see `task.0338`)
- Bound to a real DAO (see `task.0339`)
- Running a real singularity-score synth (see `task.0340`)
- Running a self-scheduling brain (see `task.0341`)

The singularity route at `src/app/api/v1/singularity/route.ts` returns a placeholder JSON so downstream probes have something to query once the node is flightable.

## Scope fence (CANARY_SCOPE_FENCE)

The canary's autonomous PR authorship is restricted to:

- `nodes/canary/**`
- `work/items/**` (new items owned by canary-bot only)
- `docs/research/**`

Denied paths (enforced by `.cogni/rules/ai-only-repo-policy.yaml`):

- `.github/workflows/**`
- `scripts/ci/**`
- `infra/**`
- `work/charters/**`
- Any `nodes/<other>/**`

## Brain constraints

- 4o-mini is the ONLY scheduled-charter model path allowed until CP5 revenue threshold.
- Haiku / Kimi / DeepSeek / Qwen are permitted as fallbacks when 4o-mini rate-limits.
- **Claude is explicitly excluded** from scheduled brain loops. Human-invoked Claude calls (Derek debugging) are permitted; the governance-charter path is enforcement-gated in LiteLLM.

## Adding to this node

1. Read [`docs/guides/new-node-formation.md`](../../docs/guides/new-node-formation.md) end-to-end.
2. Respect the scope fence — if your change needs to touch something outside it, open an issue instead and tag Derek.
3. `pnpm --filter @cogni/canary-app build` locally before pushing.
4. All structured logs carry `{ app: "canary", node_id: "89612f02-..." }` — the Loki queries in work items rely on this.

## Related

- [proj.cogni-canary](../../work/projects/proj.cogni-canary.md)
- [task.0337](../../work/items/task.0337.canary-node-port.md) — this port
- [task.0338](../../work/items/task.0338.canary-infra-catalog.md) — CI/k8s/overlays
- [task.0339](../../work/items/task.0339.canary-dao-formation.md) — on-chain DAO
- [task.0340](../../work/items/task.0340.canary-confidence-score.md) — /api/v1/singularity
- [task.0341](../../work/items/task.0341.canary-self-scheduler.md) — self-scheduling brain
- [task.0342](../../work/items/task.0342.gitcogni-ai-only-repo-policy.md) — the scope-fence policy
- [canary DAO formation runbook](../../docs/runbooks/CANARY_DAO_FORMATION.md)
