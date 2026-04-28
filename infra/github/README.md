<!--
SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
SPDX-FileCopyrightText: 2025 Cogni-DAO
-->

# infra/github

GitOps source-of-truth for repository-scope GitHub configuration. Today this covers branch protection and merge queue config for `main`.

The GitHub UI accepts changes anywhere — these files are not auto-applied. They exist so that:

1. The current intended state is reviewable in code (PR diff = config diff).
2. A new operator can re-apply the config from scratch without spelunking through Settings.
3. Drift is detectable (compare API GET vs file).

## Apply procedure (one-time, repo-admin only)

Prerequisites: `gh` authed as a repo admin.

```bash
# 1. Apply branch protection (idempotent).
#    The script strips _comment keys before sending to the API.
jq 'del(._comment)' infra/github/branch-protection.json \
  | gh api -X PUT repos/Cogni-DAO/node-template/branches/main/protection --input -

# 2. Enable repo-level auto-merge (one-time setting; required before merge queue is meaningful).
#    UI: Settings → General → Pull Requests → check "Allow auto-merge".
#    No stable REST endpoint; UI is canonical.

# 3. Enable merge queue on main (UI is canonical at time of writing).
#    UI: Settings → Branches → branch protection rule for main → check
#    "Require merge queue" → fill the form using values from
#    infra/github/merge-queue.json.

# 4. Verify.
gh api repos/Cogni-DAO/node-template/branches/main/protection \
  | jq '.required_status_checks.contexts'
# expected: ["CodeQL","Validate PR title","static","unit","component","stack-test","manifest"]
```

## Drift detection

```bash
# Branch protection drift (file vs live):
diff <(jq 'del(._comment)' infra/github/branch-protection.json) \
     <(gh api repos/Cogni-DAO/node-template/branches/main/protection \
        | jq '{required_status_checks:{strict:.required_status_checks.strict,contexts:.required_status_checks.contexts},
               enforce_admins:null,required_pull_request_reviews:null,restrictions:null,
               required_linear_history:.required_linear_history.enabled,
               allow_force_pushes:.allow_force_pushes.enabled,allow_deletions:.allow_deletions.enabled,
               required_conversation_resolution:.required_conversation_resolution.enabled,
               lock_branch:.lock_branch.enabled,allow_fork_syncing:.allow_fork_syncing.enabled}')
```

## Why this isn't a reconciler workflow yet

A reconciler-on-`push:main` would auto-apply on file change. Skipped for v0:

- Requires a GitHub App with `administration:write`, expanding the App's blast radius.
- File changes are rare (~quarterly).
- One-time apply per change is acceptable.

Revisit if drift becomes a recurring issue or if change frequency rises.

## Related

- [Agentic Contribution Loop](../../docs/spec/agentic-contribution-loop.md) — where merge queue fits in the contributor flow
- [task.0391](../../work/items/task.0391.enable-merge-queue.md) — original adoption rationale
