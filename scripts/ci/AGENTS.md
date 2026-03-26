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
- **CLI (if any):** `build.sh`, `push.sh`, `deploy.sh`, `test-image.sh`, `promote-k8s-image.sh`, `check-gitops-manifests.sh`, `check-gitops-service-coverage.sh`, `build-service.sh`, `validate-dsns.sh`, `loki_push.sh`, `fetch_github_job_logs.sh`
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

- **Internal:** `../../infra/tofu/cherry/app/`
- **External:** Docker, OpenTofu, git, curl, jq

## Change Protocol

- Update this file when **script interfaces** or **environment variables** change
- Bump **Last reviewed** date
- Coordinate with actual pipeline definitions in /.github/workflows/

## Notes

- Scripts called from GitHub Actions workflows in `.github/workflows/`
- `build.sh` builds APP_IMAGE (runner target) and MIGRATOR_IMAGE (migrator target)
- `build-service.sh` builds scheduler-worker image
- `deploy.sh` deploys Compose infrastructure (app, postgres, temporal, litellm) via SSH. Services in `services/` (scheduler-worker, sandbox-openclaw) are NOT deployed by this script — they are managed by Argo CD on k3s.
- `promote-k8s-image.sh` updates the Kustomize overlay with a new `@sha256:` digest and commits to staging with `[skip ci]`. Argo CD auto-syncs.
- `check-gitops-service-coverage.sh` validates every `services/` dir is declared in `gitops-service-catalog.json` and has base + overlay + Application manifests
- `check-gitops-manifests.sh` renders all managed service overlays via `kubectl kustomize` to catch broken manifests
