---
id: deploy.config-reconciliation
type: spec
title: Deploy-time Config Reconciliation via Config Hashes
status: draft
spec_state: draft
trust: draft
summary: Hash bind-mounted config inputs per service, inject hash as container label, let Compose recreate on diff
read_when: Adding a new service with bind-mounted config, debugging why config changes don't take effect after deploy
implements: proj.reliability
owner: derekg1729
created: 2026-02-10
verified:
tags: [infra, deploy, config]
---

# Deploy-time Config Reconciliation via Config Hashes

> Hash each service's config inputs, inject the hash as a container label, and let Compose's own reconciliation recreate the container when the hash changes.

### Key References

|             |                                                                   |                         |
| ----------- | ----------------------------------------------------------------- | ----------------------- |
| **Project** | [proj.reliability](../../work/projects/proj.reliability.md)       | Parent project          |
| **Bug**     | [bug.0017](../../work/items/bug.0017.deploy-config-reload-gap.md) | Motivating incident     |
| **Spec**    | [observability](./observability.md)                               | Log collection contract |

## Design

### Why Compose Doesn't Help

Docker Compose recreates containers when the **service definition** changes (image, env, labels, command). It does **not** detect bind-mounted file content changes. Additionally, Docker bind mounts lock to the **inode** at container creation — `rsync` replaces files atomically (new inode), so even reload endpoints inside the container read stale content. Only a container **restart** picks up the new file.

### The Fix: One Label Per Service

```
deploy.sh (on VM)
  │
  ├─ for each service with config files:
  │    hash = sha256(cat file1 file2 ...)
  │    emit: services.<name>.labels.cogni.config_hash = <hash>
  │
  ├─ write docker-compose.config-hashes.generated.yml
  │
  └─ docker compose -f base.yml -f generated.yml up -d
       └─ Compose sees label changed → recreates container
```

That's it. No reload endpoints, no signal handlers, no file watchers.

### Generated Compose Override

```yaml
# docker-compose.config-hashes.generated.yml (generated at deploy, never committed)
services:
  litellm:
    labels:
      cogni.config_hash: "a1b2c3d4..."
  alloy:
    labels:
      cogni.config_hash: "e5f6a7b8..."
  caddy:
    labels:
      cogni.config_hash: "c9d0e1f2..."
```

### Service → Config Mapping

Declared inline in deploy.sh as an associative array:

```bash
declare -A CONFIG_INPUTS=(
  [litellm]="configs/litellm.config.yaml"
  [alloy]="configs/alloy-config.metrics.alloy"
  [caddy]="configs/Caddyfile.tmpl"
)
```

Adding a new service = one line in this array. No external registry file.

### Hash Function

```bash
config_hash() {
  local service="$1"; shift
  cat "$@" | sha256sum | cut -d' ' -f1
}
```

Inputs are concatenated in declared order and hashed as raw bytes. No canonicalization — if the file changed at all, the hash changes.

## Goal

Eliminate silent config drift. When a bind-mounted config file changes between deploys, the affected container is recreated. When nothing changed, nothing restarts.

## Non-Goals

- **Kubernetes** — K8s ConfigMap hash annotations are a separate pattern (see [proj.cicd-services-gitops](../../work/projects/proj.cicd-services-gitops.md))
- **Runtime config watching** — no file watchers, no systemd.path; config is applied at deploy time only
- **Reload endpoints** — `recreate` is the only apply mode; reload is unreliable due to the inode trap
- **Secret rotation** — secrets are env vars, not bind-mounted files
- **Pre-flight config validation** — separate concern; can be added later

## Invariants

| Rule                         | Constraint                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| NO_RSYNC_ONLY_SUCCESS        | Deploy is not successful unless config changes are applied (container recreated)            |
| CONFIG_HASH_IS_DESIRED_STATE | Every service with bind-mounted config has `cogni.config_hash` label = `sha256(all inputs)` |
| DIFF_DRIVEN_RECONCILIATION   | If hash differs from running container's label, Compose recreates the container             |
| FAIL_CLOSED_ON_APPLY         | If `docker compose up -d` fails, deploy fails — no partial success                          |
| OBSERVABLE_APPLY             | Deploy logs `{service, oldHash, newHash, result}` for every service with a hash change      |

### File Pointers

| File                                               | Purpose                                   |
| -------------------------------------------------- | ----------------------------------------- |
| `scripts/ci/deploy.sh`                             | Implementation target (remote heredoc)    |
| `infra/compose/runtime/docker-compose.yml`         | Base compose — services with config files |
| `infra/compose/configs/litellm.config.yaml`        | LiteLLM model routing config              |
| `infra/compose/configs/alloy-config.metrics.alloy` | Alloy log collection config               |
| `infra/compose/configs/Caddyfile.tmpl`             | Caddy TLS/proxy config                    |

## Acceptance Checks

```bash
# 1. Config change → container recreated
# Modify alloy config, deploy, check container age < deploy time
docker inspect cogni-runtime-alloy-1 --format '{{.State.StartedAt}}'

# 2. No change → no restart (idempotent)
# Deploy twice with no config changes; container uptime spans both deploys

# 3. Generated override exists with hashes
cat /opt/cogni-template-runtime/docker-compose.config-hashes.generated.yml
# Must contain cogni.config_hash for each registered service

# 4. Deploy log shows reconciliation
grep "config_hash" /var/log/cogni/deploy.log
# Shows: service=alloy oldHash=abc newHash=def result=recreated
```

## Open Questions

- [ ] Should the bespoke LiteLLM restart (deploy.sh:688-711) and Caddy reload (deploy.sh:548-564) be deleted entirely in favor of the label mechanism, or kept as a fallback during migration?

## Related

- [proj.reliability](../../work/projects/proj.reliability.md) — parent project
- [proj.cicd-services-gitops](../../work/projects/proj.cicd-services-gitops.md) — K8s migration makes this spec's Compose mechanism obsolete
- [observability](./observability.md) — Alloy config reconciliation is the motivating case
