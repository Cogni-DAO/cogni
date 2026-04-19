---
id: bug.0330
type: bug
title: poly /api/v1/chat/completions intermittently returns empty body on candidate-a
status: needs_triage
priority: 2
rank: 50
estimate: 3
summary: The bug.0322 cross-node smoke check on candidate-a (`scripts/ci/smoke-candidate.sh`) POSTs `gpt-4o-mini` against poly's `/api/v1/chat/completions` and parses `.id`. Twice on 2026-04-19 the call returned an empty body — once after a ~4-hour stall — failing the candidate flight for PRs that did not touch poly. Underlying cause unknown; suspected upstream LiteLLM stall or pod-side timeout returning 200/empty.
outcome: poly's `/api/v1/chat/completions` either returns a well-formed completion or a non-2xx error within a bounded time. No empty 2xx bodies. Smoke check passes deterministically when poly is healthy.
spec_refs:
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels: [poly, candidate-flight, flake, litellm]
external_refs:
---

# poly `/api/v1/chat/completions` intermittently returns empty body on candidate-a

## Observations (2026-04-19, candidate-flight on `main`)

| Run                                                                                                              | Start (UTC) | Smoke step end (UTC) | Wall time  | Outcome            |
| ---------------------------------------------------------------------------------------------------------------- | ----------- | -------------------- | ---------- | ------------------ |
| [24634057685 / 72026307249](https://github.com/Cogni-DAO/node-template/actions/runs/24634057685/job/72026307249) | 16:47:06    | 21:24:57             | **4h 37m** | empty body, exit 1 |
| [24626250467](https://github.com/Cogni-DAO/node-template/actions/runs/24626250467)                               | 09:53:29    | 09:55:28             | ~2m        | empty body, exit 1 |
| Most other runs same day                                                                                         | —           | —                    | —          | success            |

Failure log (both runs):

```
[bug.0322] cross-node isolation check
[ERROR] poly chat/completions did not return an id:
##[error]Process completed with exit code 1.
```

The body printed after `id:` is empty — `curl` succeeded (no transport error) but the response had no JSON.

## Hypotheses

- LiteLLM upstream call (OpenRouter / OpenAI) stalls; poly's chat handler eventually returns 200 with no body instead of erroring.
- Poly worker process restarted mid-call; ingress closed the upstream connection cleanly with empty body.
- Cloudflare / Caddy edge timeout returning 200/empty.

## Repro

Hit poly's `/api/v1/chat/completions` against candidate-a in a tight loop:

```bash
API_KEY=$(curl -sk -X POST https://poly-test.cognidao.org/api/v1/agent/register \
  -H 'Content-Type: application/json' -d '{"name":"flake-repro"}' | jq -r .apiKey)
for i in $(seq 1 200); do
  body=$(curl -sk --max-time 90 -X POST https://poly-test.cognidao.org/api/v1/chat/completions \
    -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"gpt-4o-mini","graph_name":"poet","messages":[{"role":"user","content":"hi"}]}')
  echo "$i: ${#body} bytes"
done
```

Capture poly pod logs + LiteLLM proxy audit log for any 0-byte responses.

## Mitigations already shipped

- This commit adds `--max-time` to every curl in `scripts/ci/smoke-candidate.sh` so a stalled poly fails the smoke in ≤90s instead of holding the candidate slot for hours.
- This commit scopes per-node smoke probes to `PROMOTED_APPS` so a PR that didn't touch poly skips the call entirely. (Hides the underlying flake when only operator/resy was promoted — does not fix it.)

## Acceptance

- [ ] Root cause identified (LiteLLM proxy / poly handler / edge / network)
- [ ] poly chat handler returns non-2xx on upstream failure instead of empty 200
- [ ] Repro loop above shows zero empty-body responses across ≥1000 calls
- [ ] If LiteLLM-side: configure response timeout + retries

## Validation

- Run the repro loop in the section above against candidate-a; confirm 0 empty-body responses across ≥1000 calls.
- Re-fly a poly-touching PR through `candidate-flight.yml`; smoke-candidate's bug.0322 step passes deterministically over 5 consecutive flights.
- Inspect poly pod logs and LiteLLM proxy audit log during the loop; no 0-byte response entries.
