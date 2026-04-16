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
- **CLI (if any):** `build.sh`, `push.sh`, `deploy.sh`, `deploy-infra.sh`, `test-image.sh`, `promote-k8s-image.sh`, `promote-to-preview.sh`, `create-release.sh`, `validate-dsns.sh`, `ensure-temporal-namespace.sh`, `compute_migrator_fingerprint.sh`, `check-gitops-manifests.sh`, `check-gitops-service-coverage.sh`, `loki_push.sh`, `fetch_github_job_logs.sh`, `healthcheck-openclaw.sh`, `seed-pnpm-store.sh`
- **Env/Config keys:** `IMAGE_NAME`, `IMAGE_TAG`, `APP_IMAGE`, `MIGRATOR_IMAGE`, `COGNI_REPO_URL`, `COGNI_REPO_REF`, `PLATFORM`, `GHCR_PAT`, `CHERRY_AUTH_TOKEN`, `TF_VAR_*`, `POSTGRES_ROOT_USER`, `POSTGRES_ROOT_PASSWORD`, `APP_DB_USER`, `APP_DB_PASSWORD`, `APP_DB_NAME`, `LOKI_URL`, `LOKI_USER`, `LOKI_TOKEN`, `INTERNAL_OPS_TOKEN`, `LOG_FILE`, `JOB_NAME`, `LABELS`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `OUTPUT_FILE`
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
- PLATFORM env: native locally (fast), linux/amd64 in CI
- `deploy.sh` uses checksum-gated restart for LiteLLM: compares SHA256 of config file against stored hash at `/var/lib/cogni/litellm-config.sha256`, restarts only if changed
- `deploy.sh` runs `git-sync` as a bootstrap step before db-provision to populate `/repo` volume for brain tools
- `deploy.sh` sources `seed-pnpm-store.sh` (Step 7.5) to idempotently seed the `pnpm_store` Docker volume from a GHCR store image
- `deploy.sh` uses targeted pulls: only per-deploy images (app, migrator, scheduler-worker) and sandbox `:latest` images (cogni-sandbox-openclaw, pnpm-store) are explicitly pulled. The `:latest` pulls do a manifest check (~2s) and skip download if unchanged. Static/pinned images (postgres, litellm, alloy, temporal, autoheal, nginx, git-sync, busybox) use local Docker cache and are pulled by `compose up -d` only when missing.
- `deploy.sh` SSH connections use `ServerAliveInterval=15 ServerAliveCountMax=12` to prevent broken pipe on long operations
- `COGNI_REPO_URL`, `COGNI_REPO_REF`, `GIT_READ_TOKEN`, and `GIT_READ_USERNAME` are required env vars for deploy.sh, set by CI workflows
