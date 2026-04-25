# ci · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

CI/CD automation scripts and configuration documentation for multiple pipeline systems.

## Pointers

- [build.sh](build.sh): Build Docker images
- [deploy.sh](deploy.sh): Deploy to infrastructure

## Boundaries

```json
{
  "layer": "scripts",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Public Surface

- **Exports:** none
- **CLI (if any):** `build.sh`, `push.sh`, `deploy.sh`, `deploy-infra.sh`, `test-image.sh`, `promote-k8s-image.sh`, `flight-preview.sh`, `set-preview-review-state.sh`, `create-release.sh`, `validate-dsns.sh`, `ensure-temporal-namespace.sh`, `compute_migrator_fingerprint.sh`, `check-gitops-manifests.sh`, `check-gitops-service-coverage.sh`, `loki_push.sh`, `fetch_github_job_logs.sh`, `healthcheck-openclaw.sh`, `seed-pnpm-store.sh`, `detect-affected.sh`, `build-and-push-images.sh`, `write-build-manifest.sh`, `resolve-pr-build-images.sh`, `promote-build-payload.sh`, `promote-preview-seed-main.sh`, `acquire-candidate-slot.sh`, `release-candidate-slot.sh`, `report-candidate-status.sh`, `wait-for-candidate-ready.sh`, `smoke-candidate.sh`, `wait-for-argocd.sh`, `wait-for-in-cluster-services.sh`, `verify-buildsha.sh`, `update-source-sha-map.sh`
- **Env/Config keys:** `IMAGE_NAME`, `IMAGE_TAG`, `APP_IMAGE`, `MIGRATOR_IMAGE`, `COGNI_REPO_URL`, `COGNI_REPO_REF`, `PLATFORM`, `GHCR_PAT`, `CHERRY_AUTH_TOKEN`, `TF_VAR_*`, `POSTGRES_ROOT_USER`, `POSTGRES_ROOT_PASSWORD`, `APP_DB_USER`, `APP_DB_PASSWORD`, `APP_DB_NAME`, `LOKI_URL`, `LOKI_USER`, `LOKI_TOKEN`, `INTERNAL_OPS_TOKEN`, `LOG_FILE`, `JOB_NAME`, `LABELS`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `OUTPUT_FILE`, `TARGETS`, `TURBO_SCM_BASE`, `TURBO_SCM_HEAD`, `PR_NUMBER`, `HEAD_SHA`, `RUN_ID`, `RUN_ATTEMPT`, `WORKFLOW_NAME`, `REF_NAME`, `GHCR_USERNAME`, `GHCR_TOKEN`, `IMAGES_FILE`, `MANIFEST_FILE`, `PAYLOAD_FILE`, `OVERLAY_ENV`, `SLOT`, `LEASE_FILE`, `STATUS_URL`, `TTL_MINUTES`, `STATE`, `DESCRIPTION`, `TARGET_URL`, `CONTEXT`, `DOMAIN`, `MAX_ATTEMPTS`, `SLEEP_SECONDS`, `VM_HOST`, `DEPLOY_ENVIRONMENT`, `EXPECTED_SHA`, `EXPECTED_BUILDSHA`, `NODES`, `SOURCE_SHA_MAP`, `ARGOCD_SYNC_VERIFIED`, `MAP_FILE`, `MAP_SCRIPT`, `PROMOTED_APPS`, `ARGOCD_TIMEOUT`, `ACTIVE_SYNC_AFTER`, `SSH_OPTS`, `SSH_KEY`, `ROLLOUT_TIMEOUT`
- **Files considered API:** `scripts/*.sh`

## Responsibilities

- This directory **does**: Provide CI-agnostic deployment automation with artifact capture and documentation
- This directory **does not**: Contain pipeline YAML definitions or application logic

## Usage

Minimal local commands:

```bash
scripts/build.sh
scripts/push.sh
scripts/deploy.sh
scripts/loki_push.sh  # Push logs to Loki (requires LOKI_URL, LOKI_USER, LOKI_TOKEN, LOG_FILE, JOB_NAME, LABELS)
scripts/fetch_github_job_logs.sh  # Fetch job logs from GitHub Actions API (requires GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_JOB, OUTPUT_FILE)
```

## Standards

- Provider-agnostic scripts callable from any CI system
- Environment variable based configuration with sensitive value protection
- Fail-fast with clear error messages and artifact capture

## Dependencies

- **Internal:** `../../infra/provision/cherry/app/`
- **External:** Docker, OpenTofu, git, curl, jq

## Change Protocol

- Update this file when **script interfaces** or **environment variables** change
- Bump **Last reviewed** date
- Coordinate with actual pipeline definitions in /.github/workflows/

## Notes

- Scripts designed to be called from GitHub Actions or Jenkins
- Keep actual YAML pipelines in repository root .github/ directory
- `build.sh` builds both APP_IMAGE (runner target) and MIGRATOR_IMAGE (migrator target)
- Tag coupling: MIGRATOR_IMAGE = IMAGE_NAME:IMAGE_TAG-migrate
- `detect-affected.sh` mirrors the repo's turbo-aware SCM base/head selection and maps changed paths onto deployable image targets via each catalog entry's `path_prefix:` field (`CATALOG_IS_SSOT`, ci-cd.md axiom 16)
- `lib/image-tags.sh` is a thin shim that populates `ALL_TARGETS` / `NODE_TARGETS` and resolves `tag_suffix_for_target` by reading `infra/catalog/*.yaml` at source time via the pre-installed `yq`. Repo-root-relative resolution; override via `COGNI_CATALOG_ROOT` for fixtures.
- `build-and-push-images.sh` is the PR-build entrypoint for affected image pushes; workflows should pass resolved targets, not inline Docker command graphs
- `write-build-manifest.sh` writes the canonical build artifact consumed by later candidate-flight automation
- `resolve-pr-build-images.sh` resolves digest refs from the deterministic PR tag convention when candidate-flight needs the current pushed image set
- `promote-build-payload.sh` translates a resolved image payload into overlay mutations via `promote-k8s-image.sh`, writes `promoted_apps=<csv>` to `$GITHUB_OUTPUT` incrementally after each successful promotion (trap EXIT guarantees the exit-time write even on abort — bug.0328), and merges per-app `source_sha` into `.promote-state/source-sha-by-app.json`. Map-write failures are `::warning::` annotations; total map-write failure exits non-zero so provenance decay cannot silently persist.
- `acquire-candidate-slot.sh`, `release-candidate-slot.sh`, and `report-candidate-status.sh` are the minimal control-plane scripts for one-slot candidate flight
- PLATFORM env: native locally (fast), linux/amd64 in CI
- `deploy.sh` uses checksum-gated restart for LiteLLM: compares SHA256 of config file against stored hash at `/var/lib/cogni/litellm-config.sha256`, restarts only if changed
- `deploy.sh` runs `git-sync` as a bootstrap step before db-provision to populate `/repo` volume for brain tools
- `deploy.sh` sources `seed-pnpm-store.sh` (Step 7.5) to idempotently seed the `pnpm_store` Docker volume from a GHCR store image
- `deploy.sh` uses targeted pulls: only per-deploy images (app, migrator, scheduler-worker) and sandbox `:latest` images (cogni-sandbox-openclaw, pnpm-store) are explicitly pulled. The `:latest` pulls do a manifest check (~2s) and skip download if unchanged. Static/pinned images (postgres, litellm, alloy, temporal, autoheal, nginx, git-sync, busybox) use local Docker cache and are pulled by `compose up -d` only when missing.
- `deploy.sh` SSH connections use `ServerAliveInterval=15 ServerAliveCountMax=12` to prevent broken pipe on long operations
- `COGNI_REPO_URL`, `COGNI_REPO_REF`, `GIT_READ_TOKEN`, and `GIT_READ_USERNAME` are required env vars for deploy.sh, set by CI workflows
- `wait-for-argocd.sh` requires `PROMOTED_APPS` from the caller (no hardcoded default; emit via a decide job or upstream promote step). Acceptance is "EXPECTED_SHA identical-to or ancestor-of `status.sync.revision`" (compare-API ancestry on the VM, falls back to strict equality if `GH_TOKEN`/`GH_REPO` are unset) AND `status.health.status == Healthy`, not the top-level `sync.status`. `EXPECTED_SHA` MUST be a deploy-branch commit. While mismatched: first kick after `ACTIVE_SYNC_AFTER` (default 30s) does hard refresh + hook-sync `kubectl patch`; further kicks every `SYNC_KICK_INTERVAL` (default 45s). `ARGOCD_TIMEOUT` is a per-promoted-app budget. Before trusting rollout status, the promoted app's Deployment resource inside the Argo Application must report `status=Synced`.
