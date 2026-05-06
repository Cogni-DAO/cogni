#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Validate a Grafana Cloud PDC signing token directly against the certificate
# signer. This does not touch Postgres, Docker, SSH, or Grafana datasources.
#
# Requires:
#   GRAFANA_PDC_SIGNING_TOKEN
#
# Required from Grafana's generated Docker command:
#   GRAFANA_PDC_HOSTED_GRAFANA_ID
#
# Optional overrides:
#   GRAFANA_PDC_CLUSTER

set -euo pipefail

log() {
  echo "[grafana-pdc-preflight] $*"
}

fail() {
  echo "[grafana-pdc-preflight] ERROR: $*" >&2
  exit 1
}

usage() {
  sed -n '2,18p' "$0" >&2
}

base64url_decode() {
  local value="${1//-/+}"
  value="${value//_/\/}"
  while (( ${#value} % 4 != 0 )); do
    value="${value}="
  done
  if ! printf '%s' "$value" | base64 -d 2>/dev/null; then
    printf '%s' "$value" | base64 -D
  fi
}

json_string_field() {
  local json="$1" field="$2"
  printf '%s' "$json" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p"
}

json_region_field() {
  local json="$1"
  printf '%s' "$json" | sed -n 's/.*"m"[[:space:]]*:[[:space:]]*{[^}]*"r"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${GRAFANA_PDC_SIGNING_TOKEN:-}" ]]; then
  for candidate in "${COGNI_ENV_FILE:-}" ./.env.candidate-a ./.env.cogni ./.env.local; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      set -a; . "$candidate"; set +a
      [[ -n "${GRAFANA_PDC_SIGNING_TOKEN:-}" ]] && break
    fi
  done
fi

: "${GRAFANA_PDC_SIGNING_TOKEN:?GRAFANA_PDC_SIGNING_TOKEN not set}"

[[ "$GRAFANA_PDC_SIGNING_TOKEN" == glc_* ]] || fail "GRAFANA_PDC_SIGNING_TOKEN must start with glc_"

decoded="$(base64url_decode "${GRAFANA_PDC_SIGNING_TOKEN#glc_}" 2>/dev/null || true)"
[[ -n "$decoded" ]] || fail "could not base64url-decode GRAFANA_PDC_SIGNING_TOKEN"

hosted_id="${GRAFANA_PDC_HOSTED_GRAFANA_ID:-}"
cluster="${GRAFANA_PDC_CLUSTER:-$(json_region_field "$decoded")}"
# Token name (the .n field) is informational only — Grafana does not route by
# token name, and there is no reliable way to derive the PDC network identifier
# from the token alone. PDC datasource routing is bound through the Grafana UI.
token_name="$(json_string_field "$decoded" n)"

[[ -n "$hosted_id" ]] || fail "GRAFANA_PDC_HOSTED_GRAFANA_ID is required; copy it from Grafana's generated pdc-agent Docker command"
[[ -n "$cluster" ]] || fail "GRAFANA_PDC_CLUSTER is unset and could not be derived from token"

command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v ssh-keygen >/dev/null 2>&1 || fail "ssh-keygen is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
chmod 700 "$tmpdir"

ssh-keygen -q -t ed25519 -N '' -C grafana-pdc-preflight -f "$tmpdir/key" >/dev/null
public_key="$(cat "$tmpdir/key.pub")"

jq -n --arg publicKey "$public_key" '{publicKey: $publicKey}' > "$tmpdir/request.json"

cat > "$tmpdir/curl.conf" <<EOF
user = "${hosted_id}:${GRAFANA_PDC_SIGNING_TOKEN}"
EOF
chmod 600 "$tmpdir/curl.conf"

endpoint="https://private-datasource-connect-api-${cluster}.grafana.net/pdc/api/v1/sign-public-key"

log "endpoint=${endpoint}"
log "hostedGrafanaId=${hosted_id}"
log "tokenName=${token_name}"

http_status="$(
  curl -sS -o "$tmpdir/response.json" -w '%{http_code}' \
    --config "$tmpdir/curl.conf" \
    -H 'content-type: application/json' \
    --data @"$tmpdir/request.json" \
    "$endpoint"
)"

if [[ "$http_status" =~ ^2[0-9][0-9]$ ]]; then
  log "signer preflight passed: HTTP ${http_status}"
  exit 0
fi

preview="$(tr -d '\n' < "$tmpdir/response.json" | cut -c1-240)"
log "signer preflight failed: HTTP ${http_status}"
log "response=${preview}"

if [[ "$http_status" == "401" || "$preview" == *"invalid authentication credentials"* ]]; then
  fail "Grafana PDC signer rejected the token credentials"
fi

fail "Grafana PDC signer returned unexpected HTTP ${http_status}"
