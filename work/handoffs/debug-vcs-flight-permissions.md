# Debug: core\_\_vcs_flight_candidate GitHub App Permission Issue

## Problem

The `core__vcs_flight_candidate` tool is failing with:

```
"Resource not accessible by integration"
https://docs.github.com/rest/actions/workflows#create-a-workflow-dispatch-event
```

This happens when running on **poly-test** (the test Cogni app/node) when trying to flight PR #976.

## Context

- **Tool**: `core__vcs_flight_candidate` (part of PR Manager / VCS flight capability)
- **Environment**: poly-test node running at https://poly-test.cognidao.org
- **PR attempted**: #976
- **Same workflow works when dispatched manually** (via `gh workflow run` from CI)

## What Already Verified

- Manual `gh workflow run candidate-flight.yml --repo Cogni-DAO/node-template -f pr_number=961` works fine
- The GitHub App has "Actions" and "Workflows" permissions set to "Read and write" in GitHub settings
- PR #961 flighted successfully via CI (run 24750326973)

## Investigation Steps

1. **Find the VCS flight tool implementation** - Search for where `core__vcs_flight_candidate` is implemented. The tool exists (per the error message), but the GitHub App auth might be wrong or not wired.

2. **Check which GitHub App is being used** - The tool likely uses Octokit. Need to see:
   - What installation ID / token it's using
   - Whether it's the right GitHub App (cogni-test vs cogni-prod)

3. **Get Grafana logs from poly-test** - Query Loki:

   ```
   {namespace="cogni-candidate-a", pod=~"poly-node-app-.*"} |= "vcs_flight" or |= "workflow_dispatch" or |= "Resource not accessible"
   ```

   Or from candidate-a logs around the time PR #976 was attempted:

   ```
   {namespace="cogni-candidate-a"} |= "core__vcs_flight_candidate" | json
   ```

4. **Check poly-test's GitHub App secrets** - What `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` / `GITHUB_INSTALLATION_ID` is poly-test using?

## Files to Check

- `packages/ai-tools/src/tools/vcs-flight-candidate.ts` (or similar path)
- `nodes/poly/app/src/` for how the tool is wired
- Environment secrets for poly-test node

## Expected Outcome

Identify which GitHub App is being used and why it doesn't have permission to dispatch `workflow_dispatch` events. Likely cause: the test Cogni app is using a different GitHub App than expected, or the App doesn't have the workflows permission.
