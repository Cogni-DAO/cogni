---
id: task.0297
type: task
title: "Phase 3: AI oversight tools — brain reads node streams for self-monitoring"
summary: "Add core__node_stream_read tool so brain agents can subscribe to node-level events. Enables anomaly detection via sliding window triggers."
outcome: "Brain agent asked 'what is the current deployment health?' returns live data from the node stream."
status: needs_design
priority: 0
rank: 3
estimate: 3
actor: ai
project: proj.operator-plane
project_id: proj.operator-plane
assignees: []
spec_refs:
  - data-streams-spec
  - architecture-spec
branch: integration/node-data-streams
created: 2026-04-04
updated: 2026-04-04
revision: 0
---

# Phase 3: AI Oversight via Node Streams

## Context

Phases 1-2 establish the streaming infrastructure. This phase gives AI agents read access so they can self-monitor system health, detect anomalies, and raise alerts — closing the "AI oversight" loop.

## Design

### Outcome

Stack test: invoke brain with "check deployment health" → response includes live health/CI data from the node stream, not hallucinated.

### Approach

- Add `core__node_stream_read` tool to `@cogni/ai-tools` (reads last N entries from a node stream)
- Brain graph gets the tool wired via capability
- Trigger evaluation (pure functions) can run in Temporal workflow for automated anomaly detection

### E2E Validation (AI-executable)

```bash
# Success criterion: brain agent returns stream data in response
curl -X POST https://test.cognidao.org/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is the current deployment health?"}],"model":"brain"}' \
  | jq '.choices[0].message.content' | grep -i "healthy\|down\|canary"
# Expected: response mentions actual deployment status from stream data
```

## Validation

- [ ] `core__node_stream_read` tool exists in `@cogni/ai-tools`
- [ ] Brain can invoke the tool and get real stream data
- [ ] Stack test passes with brain reading node health
- [ ] `pnpm check` passes
