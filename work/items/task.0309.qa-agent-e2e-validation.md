---
id: task.0309
type: task
title: "QA agent — reads work item, exercises feature, confirms observability post-flight"
status: needs_design
priority: 0
rank: 1
estimate: 4
created: 2026-04-09
updated: 2026-04-09
summary: "Build a specialized QA agent graph that reads a work item's validation contract, exercises the deployed feature (API + optional Playwright), queries Grafana for observability signals at the deployed SHA, and sets deploy_verified=true when all pass."
outcome: "One work item achieves deploy_verified=true via fully autonomous QA: candidate-flight passed, feature exercised, observability confirmed. This is the completion gate for proj.cicd-services-gitops."
spec_refs:
  - docs/spec/development-lifecycle.md
  - docs/spec/observability.md
  - work/projects/proj.cicd-services-gitops.md
assignees: []
credit:
project: proj.cicd-services-gitops
initiative: ini.cicd-trunk-based
branch:
---

# task.0309 — QA Agent: E2E Feature Validation

## Problem

The pipeline proves code quality (CI) and runtime health (`/readyz`, `/livez`) — but not feature correctness. After candidate flight succeeds:

- Nobody calls the actual feature endpoint
- No observability signal is confirmed for the specific feature at the deployed SHA
- `deploy_verified` on the work item is never set — "done" means merged, not proven in prod

## Agent Design

**Name:** `qa-agent`  
**Graph location (new):** `packages/langgraph-graphs/src/graphs/qa-agent/`  
**Pattern:** See existing `packages/langgraph-graphs/src/graphs/frontend-tester/` (same agent structure, different tools)

```
qa-agent
  Inputs: work_item_id, candidate_slot (default: "candidate-a")

  Tools:
  ├── core__work_item_query        existing — read validation contract from task
  ├── core__vcs_get_ci_status      existing — confirm candidate-flight: success on PR head
  ├── getCandidateHealth(slot)     task.0308 — memory%, restarts, OOM scorecard
  ├── mcp__grafana__query_loki_logs  Grafana MCP — confirm observability signal at deployed SHA
  ├── http_call(url, method, headers, body)  NEW — call feature API endpoints from task validation
  └── delegate: frontend-tester   optional — Playwright click-through for UI validation paths

  Flow:
  1. Read work item → extract ## Validation block (exercise, observability, smoke_cmd)
  2. Read getCandidateHealth() → fail if memory > 90% or restarts > 0
  3. Confirm candidate-flight status = success for this PR
  4. Execute exercise: call the feature API (http_call) or delegate to frontend-tester
  5. Query Loki for observability signal at deployed SHA
  6. Emit QA scorecard (structured JSON to stdout/log)
  7. If all pass: set deploy_verified = true on work item, commit

  Output (QA scorecard):
  {
    "work_item": "task.0309",
    "sha": "1185d6b6",
    "slot": "candidate-a",
    "health": { "memory_pct": 62, "restarts": 0, "oom_kills": 0 },
    "feature_exercise": "pass" | "fail",
    "observability": "pass" | "fail" | "no_signal",
    "overall": "pass" | "fail",
    "deploy_verified": true | false
  }
```

## Feature Validation Contract (Work Item Format)

The `## Validation` section in every task/bug must include:

```markdown
## Validation

exercise: |
POST https://test.cognidao.org/api/v1/ai/chat
Authorization: Bearer <CANDIDATE_TOKEN>
body: {"messages":[{"role":"user","content":"ping"}],"model":"gpt-4o-mini"}
assert: response.status == 200, response body contains "content"

observability: |
{namespace="cogni-candidate-a"} | json | msg="ai.llm_call_completed"
expect: ≥1 entry within 60s of exercise

smoke_cmd: |
curl -sf https://test.cognidao.org/api/v1/health | jq '.status == "ok"'
```

QA agent reads this block directly. No separate test file.

## vNext Pointer (not in this task)

- "cogni git pr review" GitHub App → add AI rule: trigger `qa-agent` as a PR check
- QA agent posts `qa-validation` commit status on PR head SHA
- This becomes the third gate alongside `build-images` and `candidate-flight`
- Trigger: after `candidate-flight: success` on the PR head

## Sequencing

```
task.0297 (flightCandidate tool)    → implement first
task.0308 (getCandidateHealth tool) → implement second
task.0309 (qa-agent graph)          → implement third, depends on both
```

## Key Pointers

| Resource                                                      | Purpose                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/langgraph-graphs/src/graphs/frontend-tester/`       | Agent graph pattern to copy                               |
| `packages/ai-tools/src/capabilities/vcs.ts`                   | VcsCapability interface (extend with flight/health tools) |
| `packages/ai-tools/src/tools/vcs-get-ci-status.ts`            | Existing tool pattern                                     |
| `apps/operator/src/adapters/server/vcs/github-vcs.adapter.ts` | GitHub adapter (add flight/health methods)                |
| `docs/spec/observability.md`                                  | Label schema + LogQL patterns                             |
| `work/items/task.0297.candidate-flight-vcs-tool.md`           | flightCandidate + getCandidateLease tools                 |
| `work/items/task.0308.deployment-observability-scorecard.md`  | getCandidateHealth + startup log SHA                      |
| `docs/spec/candidate-slot-controller.md`                      | Lease model, slot state                                   |

## Validation

- qa-agent reads `exercise:` from task.0309 itself and calls the feature endpoint
- `getCandidateHealth("candidate-a")` returns scorecard without SSH or kubectl
- Loki query `{namespace="cogni-candidate-a"} | json | msg="candidate-smoke-check"` returns pass signal
- `deploy_verified: true` is set on the work item by qa-agent autonomously
- This constitutes the E2E success milestone for proj.cicd-services-gitops

## References

- task.0297 — flightCandidate VCS tool
- task.0308 — deployment observability scorecard + getCandidateHealth
- bug.0307 — OOM that exposed the monitoring gap
- PR #845 — first candidate flight, validated agent-first API manually
