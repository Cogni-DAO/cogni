---
description: Guide for propagating environment variables across the stack
---

You've just added a new environment variable. To ensure it propagates correctly across local development, testing, CI/CD, and production, you must update multiple files.

Use this checklist to verify you haven't missed anything.

## 1. Validation & Types (The Source of Truth)

- [ ] **`src/shared/env/server.ts`** (or `client.ts`): Add the variable to the Zod schema. This ensures type safety and runtime validation.

## 2. Local Development & Documentation

- [ ] **`.env.local`**: Add the variable with a real value for this local environment.
- [ ] **`.env.test`**: Add the variable (often with a mock value) for this test environment.
- [ ] **`.env.(local|test).example`**: Add the variable with a placeholder or default value. This is the public documentation for required env vars.

## 3. Docker Compose (Runtime Stack)

If the variable is needed by the main application container:

- [ ] **`infra/compose/runtime/docker-compose.dev.yml`**: Add it to the `environment` section of the `app` service.
- [ ] **`infra/compose/runtime/docker-compose.yml`**: Add it to the `environment` section of the `app` service.

If the variable is needed by other services:

- [ ] **`infra/compose/runtime/docker-compose.yml`**: For Caddy/Edge variables (rare).

## 4. CI Pipeline (Tests)

- [ ] **`.github/workflows/ci.yaml`**: Add the variable (with a test-safe value) to **every** `env:` block that already contains similar tokens (e.g. `SCHEDULER_API_TOKEN`). There are typically 4 blocks: `static`, `component`, `contract`, and `stack` jobs. Missing a single block will cause that CI job to fail on `serverEnv()` validation.

## 5. Deployment Pipeline (VM + k3s)

To get the variable from GitHub Secrets into each environment's VM:

### A. GitHub environment secrets

Add the variable to the `candidate-a`, `preview`, and `production` GitHub environments (`gh secret set` or via `pnpm setup:secrets --env <name>`). The active deploy path reads secrets from `github.event.inputs.environment`-scoped secrets when running `candidate-flight.yml` / `promote-and-deploy.yml`.

### B. Compose infra rsync

- [ ] **`infra/compose/runtime/docker-compose.yml`** (or `.dev.yml` if dev-only): add to the service's `environment` block so the variable propagates when `scripts/ci/deploy-infra.sh` rsyncs compose to the VM.

### C. k8s Deployment env

- [ ] **`infra/k8s/base/<component>/deployment.yaml`**: add to `envFrom.secretRef` or direct `env:` entry. For node-app Deployments, the secret ref `node-app-secrets` is patched per-overlay to `{operator,poly,resy}-node-app-secrets` and those secrets are written by `pnpm setup:secrets`.

## 6. Setup Documentation

- [ ] **`scripts/setup/SETUP_DESIGN.md`**: Add the variable to the relevant secrets list so future fresh-clone setups know to provision it.
- [ ] **`scripts/setup-secrets.ts`** (if the var is a secret): add to the per-environment secret writer so `pnpm setup:secrets --env <name>` picks it up.

## See Also

- [scripts/setup/SETUP_DESIGN.md](file:///Users/derek/dev/cogni-template/scripts/setup/SETUP_DESIGN.md): Guidance on scripting setup, automated + manual env steps required.
