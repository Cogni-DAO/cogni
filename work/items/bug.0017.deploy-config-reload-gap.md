---
id: bug.0017
type: bug
title: Deploy does not reload Alloy when bind-mounted config changes
status: needs_triage
priority: 0
estimate: 1
summary: "Two-layer bug: (1) docker compose up -d does not recreate containers when bind-mounted file contents change, and (2) Docker file-level bind mounts lock to the inode at creation — rsync replaces files atomically (new inode), so even native reload endpoints see stale content. Only a container restart picks up the new file."
outcome: All bind-mounted config services (Alloy, LiteLLM, Caddy) use a single generic config-reload mechanism in deploy.sh.
spec_refs: [observability]
assignees: []
credit:
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [infra, observability, deploy]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 12
---

# Deploy does not reload Alloy when bind-mounted config changes

## Requirements

### Observed

Alloy config `alloy-config.metrics.alloy` was updated to add `openclaw-gateway|llm-proxy-openclaw` to the container allowlist (line 22). The file was rsynced to the VM at `/opt/cogni-template-runtime/configs/alloy-config.metrics.alloy`. But Alloy (up 4 days) never reloaded — `openclaw-gateway` never appeared in Loki service labels.

**Root cause (two layers):**

1. **Compose layer:** `docker compose up -d` (deploy.sh:683) only recreates containers whose **service definition** (image, command, environment, volumes path) changed. When only the **content** of a bind-mounted file changes, compose sees no diff and does nothing.

2. **Docker inode layer:** Docker file-level bind mounts (e.g. `./file.conf:/etc/app/config.conf:ro`) lock to the **inode** at container creation time. `rsync` replaces files atomically (write temp → rename = new inode). The container's bind mount still points to the old inode. **Even native reload endpoints (`/-/reload`, `caddy reload`) read stale content** because the container filesystem view is stuck on the old inode. Only a container **restart** re-resolves the bind mount path to the new inode.

**Verified on 2026-02-10:**

- Host file `/opt/cogni-template-runtime/configs/alloy-config.metrics.alloy`: NEW regex (with `openclaw-gateway|llm-proxy-openclaw`)
- Container file `/etc/alloy/config.alloy` (via `docker exec cat`): OLD regex (without)
- `curl -sX POST http://127.0.0.1:12345/-/reload` returned HTTP 200 "config reloaded" — but reloaded the **old inode content**

**Existing bespoke workarounds in deploy.sh:**

- LiteLLM (lines 688-711): hash-check `litellm.config.yaml` → `$RUNTIME_COMPOSE restart litellm` — **works** because restart re-resolves the bind mount
- Caddy (lines 548-564): hash-check `Caddyfile.tmpl` → `caddy reload` exec — **may be affected** by same inode issue if file-level bind mount

**Missing:** Alloy has no config-change gate. Neither does OpenClaw gateway config.

### Expected

When a bind-mounted config file changes between deploys, the affected service reloads its config — either via native reload endpoint or container restart.

### Reproduction

1. Change any line in `platform/infra/services/runtime/configs/alloy-config.metrics.alloy`
2. Deploy via `platform/ci/scripts/deploy.sh`
3. Observe: `docker ps` shows Alloy container uptime unchanged; old config still active

### Impact

- **Direct:** New Alloy log collection rules (container allowlist changes) are silently ignored. Operators believe logs are being collected when they aren't.
- **Incident:** This blocked diagnosis of the OpenClaw gateway hang on 2026-02-10 — gateway container logs were invisible despite the config fix being deployed.

## Allowed Changes

- `platform/ci/scripts/deploy.sh` — add generic config-reload mechanism
- No changes to Alloy image, compose service definition, or application code

## Plan

Replace the three bespoke config-change handlers with a single generic function. **Must use container restart, not just reload**, due to the inode issue.

- [ ] Add `config_restart_if_changed()` function to deploy-remote.sh (inside the heredoc at deploy.sh:308)
  - Args: `service_name`, `config_path`, `hash_file`, `restart_command`
  - Logic: hash config on host → compare to stored hash → if changed, restart container → store new hash
  - Emit deployment event on reload: `deployment.config_restart`
  - **Critical: must restart, not reload** — native reload reads from the stale inode
- [ ] Migrate LiteLLM (lines 688-711) to use `config_restart_if_changed "litellm" "$LITELLM_CONFIG" "$HASH_DIR/litellm.sha256" "$RUNTIME_COMPOSE restart litellm"`
- [ ] Migrate Caddy (lines 548-564) to use `config_restart_if_changed "caddy" "$CADDYFILE" "$HASH_DIR/caddy.sha256" "$EDGE_COMPOSE restart caddy"`
  - Note: existing `caddy reload` exec is also broken by the inode issue — must be changed to restart
- [ ] Add Alloy: `config_restart_if_changed "alloy" "/opt/cogni-template-runtime/configs/alloy-config.metrics.alloy" "$HASH_DIR/alloy.sha256" "$RUNTIME_COMPOSE restart alloy"`

## Validation

**Command:**

```bash
# 1. Change alloy config (add a comment)
echo "// test" >> platform/infra/services/runtime/configs/alloy-config.metrics.alloy
# 2. Deploy
# 3. On VM:
docker logs cogni-runtime-alloy-1 --tail 5 2>&1 | grep -i reload
# Should show config reload log
```

**Expected:** Alloy reloads config on deploy. `{service="openclaw-gateway"}` appears in Loki label values after deploy.

## Review Checklist

- [ ] **Work Item:** `bug.0017` linked in PR body
- [ ] **Spec:** observability spec invariants upheld
- [ ] **Tests:** deploy script changes tested via manual deploy
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: LiteLLM bespoke reload (deploy.sh:688-711), Caddy bespoke reload (deploy.sh:548-564)
- Alloy reload API: `POST /-/reload` on HTTP listen addr (port 12345)

## Attribution

-
