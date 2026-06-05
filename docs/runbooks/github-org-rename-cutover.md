# GitHub Org Rename Cutover

## Purpose

Prepare the repo for renaming the GitHub organization from `Cogni-DAO` to `cogni-dao`.

## Cutover Order

1. Rename the GitHub organization in GitHub settings.
2. Confirm the canonical repo resolves:

   ```bash
   gh api repos/cogni-dao/cogni --jq .full_name
   git ls-remote --heads https://github.com/cogni-dao/cogni.git main
   ```

3. Review GitHub repository and environment variables/secrets for old owner values.
   At minimum check `GH_REPOS`, `NODE_MINT_OWNER`, `NODE_TEMPLATE_OWNER`, `NODE_SUBMODULE_PARENT_OWNER`, any `COGNI_REPO_URL` overrides, and any PAT-scoped variables whose description or value names `Cogni-DAO`.
4. Merge the org-rename config PR.
5. Update local remotes:

   ```bash
   git remote set-url origin https://github.com/cogni-dao/cogni.git
   ```

6. Run the normal CI and candidate-flight validation path before treating the cutover as complete.

## Notes

GitHub redirects old repository URLs, but API callers, CODEOWNERS mentions, and configured variables/secrets should use the new canonical owner.
