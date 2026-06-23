#!/usr/bin/env bash
# OpenBao sealed-state watchdog — read-only probe + GitHub-issue upsert.
#
# Closes bug.5051's detection gap: OpenBao is Shamir 1-of-1 with no auto-unseal,
# so ANY pod restart (OOM, reboot, chart upgrade) reseals it. A sealed OpenBao
# 503s every ESO sync and every flight's `auth/kubernetes/login` — all deploys
# for all nodes block — but running pods keep serving baked-in env, so apps stay
# green and the outage is INVISIBLE without an alert. There is no PagerDuty/Slack/
# email sink in this stack; a GitHub issue is the only signal that reaches the
# maintainer. This is the bug.5011 recorded-decision item #2 ("sealed-state alert")
# that was never shipped — re-homed onto a GH-issue sink instead of Loki.
#
# This is observability/monitoring only (cicd-platform-boundary.md): a read-only
# `bao status` probe + an idempotent GitHub-issue upsert. It mutates NO infra,
# NO secrets, NO deploy state. It is NOT a deploy/promote/provision workflow and
# is explicitly allowed under the freeze.
#
# Exit-code discipline:
#   0 — state determined (UNSEALED, or SEALED-and-issue-upserted). A sealed vault
#       is a DETECTED condition, not a workflow failure; hard-failing the job on a
#       seal would itself be a silent-red (a red check operators ignore).
#   1 — PROBE ERROR: could not determine seal state (SSH/kubectl failure). THIS is
#       the failure case worth surfacing — "we are blind" is the real alarm.
#
# Usage: scripts/ci/openbao-seal-watchdog.sh <env>
#   Reads from the environment:
#     VM_HOST        — the env VM host (GitHub Environment secret, same one deploy uses)
#     GH_TOKEN       — for `gh` issue ops (github.token)
#   SSH key is expected at ~/.ssh/deploy_key (the workflow's Setup SSH step writes it).
#
# NEVER prints secret values: `bao status` exposes none, and the unseal KEY never
# appears here — recovery is the manual runbook embedded in the issue body.

set -euo pipefail

ENV_NAME="${1:?usage: openbao-seal-watchdog.sh <env>}"

ISSUE_LABEL="openbao-sealed"
ISSUE_TITLE="[openbao-sealed] ${ENV_NAME} — secret plane down, deploys blocked"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/deploy_key}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() { echo "[$ENV_NAME] $*"; }

# ----------------------------------------------------------------------------
# 1. Probe — read-only `bao status` over SSH→kubectl. No mutation whatsoever.
# ----------------------------------------------------------------------------
if [ -z "${VM_HOST:-}" ]; then
  log "::error::No VM_HOST secret set for environment '${ENV_NAME}' — cannot probe OpenBao seal state."
  exit 1
fi

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=6)

# `bao status` returns exit 2 when SEALED, 0 when unsealed — both are SUCCESSFUL
# probes. Only an SSH/kubectl/transport failure is a probe error. We therefore
# can't trust the remote exit code alone; we capture stdout and parse `.sealed`.
log "Probing openbao-0 seal state via ${VM_HOST}..."
set +e
STATUS_JSON=$("${SSH[@]}" root@"$VM_HOST" \
  "kubectl exec -n openbao openbao-0 -- bao status -format=json 2>/dev/null" 2>/tmp/ssh-err.txt)
SSH_RC=$?
set -e

# Capture pod restart count / age for the issue body (best-effort; tolerate a
# briefly-absent pod — the probe above is authoritative for seal state).
set +e
POD_INFO=$("${SSH[@]}" root@"$VM_HOST" \
  "kubectl get pod -n openbao openbao-0 -o jsonpath='restarts={.status.containerStatuses[0].restartCount} started={.status.startTime}' 2>/dev/null" 2>/dev/null)
set -e
POD_INFO="${POD_INFO:-(pod info unavailable)}"

# Determine sealed state from the JSON. If we got no parseable JSON, the probe
# itself failed — that is the genuine failure case (exit 1), distinct from a
# cleanly-determined sealed=true.
SEALED=""
if [ -n "$STATUS_JSON" ]; then
  SEALED=$(printf '%s' "$STATUS_JSON" | jq -r '.sealed // empty' 2>/dev/null || true)
fi

if [ -z "$SEALED" ]; then
  log "::error::Could not determine OpenBao seal state (probe error). ssh_rc=${SSH_RC}"
  log "ssh stderr: $(tr -d '\r' < /tmp/ssh-err.txt 2>/dev/null | head -5)"
  log "This is a BLIND state — surfacing as a job failure so the watchdog isn't silently broken."
  exit 1
fi

log "probe result: sealed=${SEALED} | ${POD_INFO}"

# ----------------------------------------------------------------------------
# 2. Reconcile a single open `openbao-sealed` issue for this env.
# ----------------------------------------------------------------------------
ensure_label() {
  gh label create "$ISSUE_LABEL" --color "b60205" \
    --description "OpenBao sealed (secret plane down) detected by openbao-seal-watchdog.yml" 2>/dev/null || true
}

find_open_issue() {
  # Match by label AND the stable per-env title, so each env owns exactly one issue.
  gh issue list --label "$ISSUE_LABEL" --state open --limit 50 \
    --json number,title \
    --jq "[.[] | select(.title == \"${ISSUE_TITLE}\")][0].number // empty"
}

if [ "$SEALED" = "true" ]; then
  ensure_label
  EXISTING="$(find_open_issue)"

  RUNBOOK_FILE=/tmp/openbao-issue-body.md
  cat > "$RUNBOOK_FILE" <<EOF
> _Auto-detected by \`.github/workflows/openbao-seal-watchdog.yml\` at ${TS}._

## 🔴 OpenBao is SEALED on \`${ENV_NAME}\` — secret plane is DOWN

A sealed OpenBao serves **nothing**. This is an **outage**, not a safe state.

- **Env:** \`${ENV_NAME}\`
- **Pod:** \`openbao-0\` — ${POD_INFO}
  (a non-zero restart count + recent \`started\` ≈ when it resealed; OpenBao is
  Shamir 1-of-1 with no auto-unseal, so **any** pod restart reseals it.)

### Impact (why this is urgent and invisible)
- Every flight's node-substrate lane **503s on \`auth/kubernetes/login\`** → **all deploys for all nodes are blocked** (a single env's seal transitively blocks every fork node's promote on that env).
- Every ESO \`ExternalSecret\` sync 503s; OpenFGA config load 503s.
- **Running pods stay green** (they serve baked-in env), so \`cognidao.org\` / the apps look healthy — the outage is invisible without this alert. Preview/prod have each been stranded for **days** this way (bug.5051).

### Recovery runbook (manual unseal — the sanctioned exception to "never SSH prod", outage-recovery only)
Run from the provisioner device (has \`.local/<env>-vm-key\` + \`.local/<env>-openbao-init.json\`):

\`\`\`bash
# 1. Unseal openbao-0. Pass the key as an ARGUMENT, not stdin — the triple-hop
#    ssh→kubectl→bao mangles a piped key.
kubectl exec -n openbao openbao-0 -- \\
  bao operator unseal '<unseal_keys_b64[0] from .local/${ENV_NAME}-openbao-init.json>'

# 2. Bounce ESO — the ClusterSecretStore caches InvalidProviderConfig and won't
#    self-clear after the unseal.
kubectl rollout restart deploy -l app.kubernetes.io/name=external-secrets
\`\`\`

### Durable fixes (bug.5051)
- Point substrate Argo apps' \`targetRevision\` at \`main\` (substrate manifests are shared source, not per-env overlay state) so the #1617 \`512Mi→1Gi\` memory bump actually reaches the cluster — it is currently a silent no-op because Argo renders \`infra/k8s/argocd/*\` from the per-env deploy branch.
- Ship auto-unseal (KMS) — the written trigger ("reseals recur post-#1617") is now MET.

### Refs
- bug.5051 (this detection gap) · bug.5011 (recorded decision: this is item #2, "sealed-state → alert", never shipped until now)
- Recovery details: \`cicd-secrets-expert\` skill → "OpenBao availability — sealed = DOWN".

_This issue auto-closes when the watchdog next observes \`${ENV_NAME}\` UNSEALED._
EOF

  if [ -n "$EXISTING" ]; then
    gh issue comment "$EXISTING" --body \
      "🔴 Still SEALED as of ${TS}. Pod: ${POD_INFO}. (watchdog re-observed; see runbook in the issue body.)"
    log "✏️  commented on existing issue #${EXISTING} (still sealed)"
  else
    NEW_URL=$(gh issue create --title "$ISSUE_TITLE" \
      --label "$ISSUE_LABEL" --label "bug" --body-file "$RUNBOOK_FILE")
    log "🆕 opened sealed-state issue: ${NEW_URL}"
  fi
  exit 0
fi

# ----------------------------------------------------------------------------
# 3. UNSEALED — self-resolve any open issue for this env. No manual hygiene.
# ----------------------------------------------------------------------------
log "OpenBao is UNSEALED on ${ENV_NAME} — healthy."
EXISTING="$(find_open_issue 2>/dev/null || true)"
if [ -n "${EXISTING:-}" ]; then
  gh issue comment "$EXISTING" --body \
    "✅ Recovered — OpenBao on \`${ENV_NAME}\` observed **UNSEALED** at ${TS}. Pod: ${POD_INFO}. Auto-closing."
  gh issue close "$EXISTING" --reason completed
  log "✅ closed recovered issue #${EXISTING}"
fi
exit 0
