---
id: task.0277
type: task
title: "Deployment validation skill — verify system account, a2a connectivity, full health"
status: needs_design
priority: 0
rank: 2
estimate: 3
summary: "Skill that validates a deployed environment end-to-end: health probes, system account bootstrap, agent-to-agent connectivity, billing pipeline, and client-side rendering. Goes beyond /readyz — proves the app actually works for users."
outcome: "Run /deployment-health against any environment URL and get a pass/fail scorecard: health probes, system tenant exists, billing callback reachable, client JS loads without crash, AI chat endpoint responds."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-03
updated: 2026-04-03
labels: [skill, deployment, observability, p0]
external_refs:
---

# Deployment Validation Skill

## Problem

CI verify job only checks /readyz and /livez. The app can return 200 on both while being completely broken for users (bug.0276 — client-side crash). We need deeper validation.

## Checks to implement

| Check            | What it proves                                     | How                                      |
| ---------------- | -------------------------------------------------- | ---------------------------------------- |
| /livez 200       | Process alive                                      | curl                                     |
| /readyz 200      | Server dependencies connected                      | curl                                     |
| Client render    | Homepage loads without JS crash                    | Playwright or curl + check for error div |
| System tenant    | cogni_system account exists in DB                  | API call or DB query                     |
| Billing pipeline | LiteLLM callback → billing ingest → charge_receipt | Send test completion, verify receipt     |
| Agent a2a        | System agent can reach other agents                | POST to agent endpoint                   |
| Version match    | Deployed SHA matches expected                      | /version endpoint                        |

## Integration

- Callable as `/deployment-health <url>` skill
- Callable from CI verify job (replace simple curl checks)
- Outputs structured scorecard (pass/fail per check)

## Validation

- [ ] Work item triaged and assigned
