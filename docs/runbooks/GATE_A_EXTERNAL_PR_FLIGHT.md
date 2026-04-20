# Gate A — External Agent PR Flight Runbook

> Tracks: [task.0345](../../work/items/task.0345.gate-a-gate-b-validation.md) § Gate A
> Prereqs: [External Agent Onboarding](../guides/external-agent-onboarding.md)
> Last verified: 2026-04-20 (design-only — not yet executable)

## Claim to prove

An agent with NO repo-write access to `Cogni-DAO/cogni-template` can open a PR against the canary node, request a candidate-a flight, and see it auto-merged once all gates pass. Total elapsed < 20 min. Zero human clicks.

## Pre-flight blockers (do not run until all ✅)

- [ ] `task.0344` shipped — `POST /api/v1/vcs/flight-candidate` HTTP route live
- [ ] `task.0338 part 2` shipped — canary reachable at `canary-candidate-a.cognidao.org`
- [ ] `task.0342` shipped — ai-only-repo-policy enforcing + `canary-bot[bot]` GH App exists
- [ ] Canary first real image is in GHCR (flight has something to promote)
- [ ] Gate B passed (wallet + billing rail proven — Gate A depends on paid flight dispatch)

Check in one shot:

```bash
curl -fsSL https://canary-candidate-a.cognidao.org/.well-known/agent.json | jq .endpoints
curl -fsSL https://canary-candidate-a.cognidao.org/api/v1/vcs/flight-candidate/ping || echo "task.0344 NOT SHIPPED — gate A cannot run"
gh api repos/Cogni-DAO/cogni-template/installation --jq '.account.login' | grep -i canary-bot || echo "task.0342 NOT SHIPPED — no canary-bot GH App"
```

## Run

### Step 1 — Register agent

```bash
export BASE=https://canary-candidate-a.cognidao.org
CREDS=$(curl -fsS -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"gate-a-ext-'$(date +%s)'"}')
export API_KEY=$(echo $CREDS | jq -r .apiKey)
export USER_ID=$(echo $CREDS | jq -r .userId)
echo "Registered: $USER_ID"
```

**Expected:** HTTP 200, apiKey starts with `cogni_ag_sk_v1_`.

### Step 2 — Fork the repo

Use the agent's GitHub App token (NOT the Cogni bearer):

```bash
export GH_TOKEN="<agent-github-app-installation-token>"
curl -fsS -X POST https://api.github.com/repos/Cogni-DAO/cogni-template/forks \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json"

# wait ~5s for fork to provision
sleep 5
export FORK_OWNER="<your-github-username-or-org>"
```

### Step 3 — Create branch + commit trivial change

```bash
BRANCH=gate-a-$(date +%s)
git clone https://$GH_TOKEN@github.com/$FORK_OWNER/cogni-template.git /tmp/gate-a
cd /tmp/gate-a
git checkout -b $BRANCH
echo "// gate-a probe $(date -u)" >> nodes/canary/app/src/app/api/v1/singularity/route.ts
git config user.name "gate-a-agent"
git config user.email "gate-a@example.com"
git add -A && git commit -m "chore(canary): gate-a probe"
git push -u origin $BRANCH
export HEAD_SHA=$(git rev-parse HEAD)
```

### Step 4 — Open PR

Via the pr-manager graph (agent-native path):

```bash
PR_RESP=$(curl -fsS -X POST $BASE/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"graph_name\":\"pr-manager\",
    \"model\":\"gpt-4o-mini\",
    \"messages\":[{
      \"role\":\"user\",
      \"content\":\"Open PR from $FORK_OWNER:$BRANCH to Cogni-DAO/cogni-template:main titled 'chore(canary): gate-a probe'\"
    }]
  }")
export PR_NUMBER=$(echo $PR_RESP | jq -r '.pr_number // empty')
echo "PR opened: #$PR_NUMBER"
```

Fallback (direct GitHub API):

```bash
PR_RESP=$(curl -fsS -X POST https://api.github.com/repos/Cogni-DAO/cogni-template/pulls \
  -H "Authorization: Bearer $GH_TOKEN" \
  -d "{
    \"title\":\"chore(canary): gate-a probe\",
    \"head\":\"$FORK_OWNER:$BRANCH\",
    \"base\":\"main\"
  }")
export PR_NUMBER=$(echo $PR_RESP | jq -r .number)
```

### Step 5 — Request candidate-a flight

```bash
FLIGHT=$(curl -fsS -X POST $BASE/api/v1/vcs/flight-candidate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"pr_number\": $PR_NUMBER, \"head_sha\": \"$HEAD_SHA\"}")
export FLIGHT_ID=$(echo $FLIGHT | jq -r .flight_id)
echo "Flight dispatched: $FLIGHT_ID"
```

### Step 6 — Stream flight progress

```bash
curl -N $BASE/api/v1/agent/runs/$FLIGHT_ID/stream \
  -H "Authorization: Bearer $API_KEY"
```

Expected terminal event: `{"type":"flight.verify_buildsha.passed","pr":...,"sha":"..."}`

### Step 7 — Observe auto-merge

```bash
# Poll PR state (give gitcogni ~60s post-verify to run)
for i in 1 2 3 4 5 6; do
  STATE=$(curl -fsS https://api.github.com/repos/Cogni-DAO/cogni-template/pulls/$PR_NUMBER \
    -H "Authorization: Bearer $GH_TOKEN" | jq -r .state)
  echo "attempt $i: $STATE"
  [[ "$STATE" == "closed" ]] && break
  sleep 10
done

# Confirm it was a MERGE, not a close-without-merge
curl -fsS https://api.github.com/repos/Cogni-DAO/cogni-template/pulls/$PR_NUMBER \
  -H "Authorization: Bearer $GH_TOKEN" | jq '{merged, merged_by: .merged_by.login}'
```

**Expected:** `{"merged": true, "merged_by": "canary-bot[bot]"}` (or your agent's bot identity).

## Proof checklist

- [ ] All Step 1–7 commands ran as scripted; no `gh` CLI was used (only `curl` + `git`)
- [ ] No human opened GitHub in a browser between fork and merge
- [ ] PR went `open → closed` within 20 min
- [ ] `/readyz.version` on `canary-candidate-a.cognidao.org` matches `$HEAD_SHA` at some point during the run (verify via `curl -s $BASE/readyz | jq .version`)
- [ ] gitcogni audit event shows `auto_merged: true`

## Troubleshooting

### Step 5 returns 404 on `/vcs/flight-candidate`

task.0344 hasn't shipped. Check workflow dispatch fallback: `gh workflow run candidate-flight.yml -f pr=$PR_NUMBER` (requires CI PAT — NOT zero-human).

### Step 7 shows PR still open after 10 min

- Check gitcogni comment on the PR for scope fence violation.
- Check candidate-flight.yml run for failure (`verify-buildsha` mismatch, Argo unhealthy).
- If blocked legitimately, the DAO-vote override path in `ai-only-repo-policy` is the only unblock. Escalate to Derek.

### Step 7 shows PR closed but `merged: false`

gitcogni closed the PR without merge (explicit reject). Check the review comment for reason. Most likely: scope fence violation or budget-cap exceeded.

## Cleanup

```bash
# Delete the fork branch (optional — fork itself persists)
git push $FORK_OWNER_REMOTE :$BRANCH
```

## Related

- [Gate B Runbook](./GATE_B_PAID_AGENT_VALIDATION.md)
- [External Agent Onboarding](../guides/external-agent-onboarding.md)
- [task.0344 — public flight API](../../work/items/task.0344.public-flight-request-surface.md)
- [task.0345 — Gate A/B validation](../../work/items/task.0345.gate-a-gate-b-validation.md)
