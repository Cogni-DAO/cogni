---
id: postmortem-main-staging-divergence
type: postmortem
title: "Postmortem: Main-Staging Divergence (EVM RPC Feature Loss)"
status: draft
trust: draft
summary: Root cause analysis of 44-day main-staging divergence caused by forbidden main-to-release merge, resulting in loss of EVM RPC validation code.
read_when: Investigating merge conflicts between main and staging, or reviewing release branch policies.
owner: derekg1729
created: 2026-01-25
tags: [deployment, incident]
---

# Postmortem: Main-Staging Divergence (EVM RPC Feature Loss)

**Date**: 2026-01-25
**Severity**: High (blocked releases for 4+ days)
**Status**: Resolved
**Related**: [CI/CD Conflict Recovery Runbook](../../docs/runbooks/CICD_CONFLICT_RECOVERY.md)

---

## Summary

Release branches from staging consistently failed to merge to main due to conflicts in `src/shared/env/invariants.ts` and `src/app/(infra)/readyz/route.ts`. Investigation revealed that main was missing 125 lines of code (EVM RPC validation features) that existed on staging since Dec 11, 2025.

---

## Root Cause

### The Forbidden Merge

**Commit**: `5a047cd`
**Message**: `Merge branch 'main' into release/20251211-4f1c3b49`
**Author**: Derek
**Date**: 2025-12-11 18:28:20 +0800

Someone 👀 merged `main` INTO the release branch, violating invariant **NO_BASE_TO_HEAD_MERGES**.

#### State at time of forbidden merge:

| Branch                                   | `invariants.ts` | Content                    |
| ---------------------------------------- | --------------- | -------------------------- |
| Release before (`4f1c3b49`)              | 149 lines       | EVM RPC validation present |
| Main at time (`76c4b9d`)                 | 80 lines        | Basic structure only       |
| **After main→release merge (`5a047cd`)** | **80 lines**    | **EVM RPC deleted**        |

The merge brought main's 80-line version into the release branch, overwriting the EVM RPC features.

### Then the corrupted release was merged to main:

**Commit**: `eb1fb92` — PR #192
**Message**: `feat(security): on-chain payment verification, remove API key db storage, standard /livez and /readyz probes`
**Date**: 2025-12-11 18:34:18 +0800

This brought the corrupted 80-line file to main, where it persisted through all subsequent merges.

---

## Timeline

| Date                    | Event                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| 2025-12-11 02:24        | PR #189 merged to main: Created `invariants.ts` with 80 lines     |
| 2025-12-11 04:23        | PR #190 merged to staging: Added EVM RPC (149 lines)              |
| **2025-12-11 18:28**    | **`5a047cd`: Forbidden merge of main INTO release**               |
| 2025-12-11 18:34        | `eb1fb92` (PR #192): Corrupted release merged to main             |
| 2025-12-11 → 2026-01-24 | All subsequent release→main merges propagated the 80-line version |
| 2026-01-24              | PR #268, #269, #270 blocked by conflicts                          |
| 2026-01-25              | Root cause identified, manual merge with correct resolution       |

---

## Why Subsequent Merges Didn't Fix It

Once main had the 80-line version and staging continued with 149 lines, every merge followed this pattern:

1. Merge-base: 149 lines (common ancestor on staging)
2. Main: 80 lines (deleted 69 lines from merge-base)
3. Release: 149 lines (no change from merge-base)

Git's three-way merge sees: _main deleted lines, release didn't change them → take main's deletion_

This is **correct merge behavior**. The deletion was intentional from Git's perspective because it was committed on the main lineage.

---

## Impact

- **44 days** of divergence (Dec 11, 2025 → Jan 25, 2026)
- **4+ days** of blocked releases during investigation
- **3 failed PRs** (#268, #269, #270)
- Required **manual override** of branch protection to resolve
- Residual divergence on 2 doc files persisted until Feb 9, 2026 (see [Addendum](#addendum-residual-conflicts-feb-9-2026))

---

## Resolution

1. Disabled `require-pinned-release-branch` check temporarily
2. Performed conflict resolution in GitHub UI with correct content (release's version)
3. Merged PR #270 with "Create a merge commit"
4. Re-enabled branch protections

**Files resolved**: `src/shared/env/invariants.ts`, `src/app/(infra)/readyz/route.ts`, CI configs, scheduler files.

**Files NOT resolved** (not conflicting at the time): `docs/PAYMENTS_DESIGN.md`, `docs/features/HEALTH_PROBES.md`. These remained silently diverged — main had versions modified by PRs #189/#192 that staging never received. See [Addendum](#addendum-residual-conflicts-feb-9-2026).

---

## Lessons Learned

### What Went Wrong

1. **Forbidden operation executed**: `git merge main` was run on a release branch
2. **Wrong conflict resolution**: When merging main into release, main's version was chosen
3. **No automated detection**: CI passed because the code was syntactically valid

### Why It Likely Happened

The release branch had conflicts with main. Instead of following the correct procedure (fix on release without merging main), the developer used GitHub's "Update branch" button or ran `git merge main`. This is exactly what the invariants forbid.

### What Went Right

1. `require-pinned-release-branch` prevented silent corruption of release branches (added after this incident's root cause)
2. CI caught syntax errors from bad manual resolutions
3. Linear history policies made the bad merge traceable

---

## Action Items

| Priority | Action                                                                                                                       | Status                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| P0       | Document: Never use "Update branch" button on release PRs                                                                    | **DONE** (in runbook)            |
| P0       | Add CI check: fail if release/\* branch has merge commits                                                                    | TODO                             |
| P1       | Add CI check: fail if release→main merge loses lines                                                                         | TODO                             |
| P1       | Audit GitHub branch protection: disable "Update branch" for release/\*                                                       | TODO                             |
| P1       | After conflict resolution, audit ALL diverged files (`git diff <merge-base> origin/main`) not just actively conflicting ones | **DONE** (learned from addendum) |

---

## Appendix: Key Commits

```
5a047cd  2025-12-11 18:28  Merge branch 'main' into release/20251211-4f1c3b49  ← ROOT CAUSE
eb1fb92  2025-12-11 18:34  feat(security): on-chain payment verification (#192)  ← Propagated to main
76c4b9d  2025-12-11 02:24  fix: virtual key exposure removal (#189)  ← Created 80-line file
bdf7cb4  2025-12-11 04:23  feat(payments): add EVM RPC verification (#190)  ← Added EVM RPC (staging only)
```

### Verification Commands

```bash
# Show the forbidden merge
git show 5a047cd --format="%s%nParents: %P" --no-patch
# Merge branch 'main' into release/20251211-4f1c3b49
# Parents: 4f1c3b49 76c4b9d

# Show file state corruption
git show 4f1c3b49:src/shared/env/invariants.ts | wc -l  # 149 (before)
git show 5a047cd:src/shared/env/invariants.ts | wc -l   # 80 (after - WRONG)

# Audit ALL diverged files between merge base and main (use after any resolution)
git diff --stat $(git merge-base origin/main origin/staging) origin/main
# ^^^ Should be empty after full resolution. Any remaining files are latent time bombs.
```

---

## Addendum: Residual Conflicts (Feb 9, 2026)

The original resolution in January only fixed the actively conflicting source files. Two documentation files were also corrupted by the same forbidden merge but were not conflicting at the time, so they went unresolved. They surfaced 2 weeks later when the docs migration (PR #340) deleted/renamed them on staging.

### How it resurfaced

The docs migration deleted `docs/PAYMENTS_DESIGN.md` and renamed `docs/features/HEALTH_PROBES.md` → `docs/spec/health-probes.md` on staging. When release/20260209-bc945329 (PR #351) carried these changes to main, the latent divergence surfaced:

- `docs/PAYMENTS_DESIGN.md`: modify/delete conflict (main had 535 lines from PRs #189/#192, release deleted it)
- `docs/features/HEALTH_PROBES.md`: rename/modify conflict (GitHub's rename detection didn't match local git's, so the rename appeared as a modify/delete conflict on GitHub)

### Why a staging-first fix was impossible

Git's 3-way merge compares three **snapshots** (merge base, main, release) — not commit history. No commit on staging could change any of these snapshots:

- Merge base (`7637063c`): only advances when a release merges to main
- Main: has the modified files from PRs #189/#192
- Any release from staging: has the files deleted/renamed

This is circular — the merge base can't advance because the release can't merge, and the release can't merge because the merge base hasn't advanced. The fix must go directly on the release branch.

### Steps taken

1. On `release/20260209-bc945329`, adopted main's version of both files to make the 3-way merge see agreement:

   ```bash
   git checkout release/20260209-bc945329

   # File 1: PAYMENTS_DESIGN.md (modify/delete)
   git checkout origin/main -- docs/PAYMENTS_DESIGN.md
   git commit -m "fix: adopt main's PAYMENTS_DESIGN.md to resolve modify/delete conflict"

   # File 2: HEALTH_PROBES.md (rename/modify — GitHub didn't detect rename)
   git checkout origin/main -- docs/features/HEALTH_PROBES.md
   git commit -m "fix: adopt main's HEALTH_PROBES.md to resolve rename/modify conflict"

   # Verify clean merge
   git merge-tree --write-tree origin/main HEAD 2>&1 | grep -i conflict
   # ^^^ Must be empty

   git push
   ```

2. Temporarily disabled `require-pinned-release-branch` check on PR #351 (GitHub → Settings → Branch protection rules → main → uncheck "Require pinned release PRs to main / require-pinned-release-branch")

3. Merged PR #351 to main

4. Re-enabled `require-pinned-release-branch` check

### Why the files temporarily reappear on main

The fix adds the files back to the release branch so both sides agree. After merge, main temporarily has both files again. The **next release cycle** automatically cleans this up: staging already has the files deleted/moved, and the now-advanced merge base means git sees only the release side changed → clean delete/rename.

### Gotcha: `merge-tree` vs GitHub

`git merge-tree` showed `HEALTH_PROBES.md` auto-merging (local git detected the rename to `docs/spec/health-probes.md`). GitHub did **not** detect the rename and reported a conflict. Always verify conflict state on GitHub, not just locally.

### Full divergence audit

After applying the fix, we audited the complete diff between the merge base and main:

```bash
git diff --stat $(git merge-base origin/main origin/staging) origin/main
```

Only the 2 doc files were diverged. Once PR #351 merges and the next release cycle completes, the merge base will advance past all Dec 2025 corruption. This should be the final remediation for this incident.
