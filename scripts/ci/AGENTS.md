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
- **CLI (if any):** `scripts/build.sh`, `scripts/push.sh`, `scripts/deploy.sh`, `scripts/test-image.sh`, `scripts/loki_push.sh`, `scripts/fetch_github_job_logs.sh`, `scripts/healthcheck-openclaw.sh`, `scripts/seed-pnpm-store.sh`, `scripts/promote-k8s-image.sh`
- **Env/Config keys:** `IMAGE_NAME`, `IMAGE_TAG`, `APP_IMAGE`, `MIGRATOR_IMAGE`, `SCHEDULER_WORKER_IMAGE`, `COMPOSE_PROFILES`, `SCHEDULER_WORKER_DIGEST`, `COGNI_REPO_URL`, `COGNI_REPO_REF`, `PLATFORM`, `GHCR_PAT`, `CHERRY_AUTH_TOKEN`, `TF_VAR_*`, `POSTGRES_ROOT_USER`, `POSTGRES_ROOT_PASSWORD`, `APP_DB_USER`, `APP_DB_PASSWORD`, `APP_DB_NAME`, `LOKI_URL`, `LOKI_USER`, `LOKI_TOKEN`, `INTERNAL_OPS_TOKEN`, `LOG_FILE`, `JOB_NAME`, `LABELS`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `OUTPUT_FILE`
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

- **Internal:** `../../infra/tofu/cherry/app/`
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
- `deploy.sh` uses targeted pulls: per-deploy images (app, migrator, and scheduler-worker if set) and sandbox `:latest` images are explicitly pulled. Static/pinned images use local Docker cache.
- `deploy.sh` is branch-free: `COMPOSE_PROFILES` env var (set by workflow) controls which profiles are active. No `--profile` flags or if/else in the script.
- `deploy.sh` SSH connections use `ServerAliveInterval=15 ServerAliveCountMax=12` to prevent broken pipe on long operations
- `promote-k8s-image.sh` updates `infra/cd/overlays/staging/kustomization.yaml` with a new `@sha256:` digest, commits to staging. Called by CI after scheduler-worker image push. Requires `SCHEDULER_WORKER_DIGEST` env var.
- `COGNI_REPO_URL`, `COGNI_REPO_REF`, `GIT_READ_TOKEN`, and `GIT_READ_USERNAME` are required env vars for deploy.sh, set by CI workflows
