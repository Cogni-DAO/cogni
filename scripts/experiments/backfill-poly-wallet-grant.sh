#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 3 || $# -gt 6 ]]; then
  cat <<'EOF' >&2
Usage:
  scripts/experiments/backfill-poly-wallet-grant.sh <billing_account_id> <wallet_connection_id> <created_by_user_id> [per_order_usdc_cap] [daily_usdc_cap] [hourly_fills_cap]

Environment:
  VM_IP   Optional. Defaults to the contents of .local/canary-vm-ip.
  SSH_KEY Optional. Defaults to .local/canary-vm-key.

Notes:
  - Candidate-a incident-response helper only.
  - Inserts exactly one active poly_wallet_grants row if none exists for the connection.
  - Does not overwrite or mutate an existing active grant.
EOF
  exit 64
fi

BILLING_ACCOUNT_ID="$1"
WALLET_CONNECTION_ID="$2"
CREATED_BY_USER_ID="$3"
PER_ORDER_USDC_CAP="${4:-2.00}"
DAILY_USDC_CAP="${5:-10.00}"
HOURLY_FILLS_CAP="${6:-10000}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VM_IP="${VM_IP:-$(cat "$REPO_ROOT/.local/canary-vm-ip")}"
SSH_KEY="${SSH_KEY:-$REPO_ROOT/.local/canary-vm-key}"

ssh -i "$SSH_KEY" \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=15 \
  "root@$VM_IP" \
  "set -euo pipefail
. /opt/cogni-template-runtime/.env
export PGPASSWORD=\"\$POSTGRES_ROOT_PASSWORD\"
cat <<SQL >/tmp/poly-backfill-grant.sql
begin;
with inserted as (
  insert into poly_wallet_grants (
    billing_account_id,
    wallet_connection_id,
    created_by_user_id,
    scopes,
    per_order_usdc_cap,
    daily_usdc_cap,
    hourly_fills_cap,
    expires_at
  )
  select
    '$BILLING_ACCOUNT_ID',
    '$WALLET_CONNECTION_ID'::uuid,
    '$CREATED_BY_USER_ID',
    array['poly:trade:buy','poly:trade:sell'],
    $PER_ORDER_USDC_CAP,
    $DAILY_USDC_CAP,
    $HOURLY_FILLS_CAP,
    null
  where not exists (
    select 1
    from poly_wallet_grants
    where wallet_connection_id = '$WALLET_CONNECTION_ID'::uuid
      and revoked_at is null
      and (expires_at is null or expires_at > now())
  )
  returning
    id,
    billing_account_id,
    wallet_connection_id,
    created_by_user_id,
    scopes,
    per_order_usdc_cap,
    daily_usdc_cap,
    hourly_fills_cap,
    expires_at,
    created_at
)
select * from inserted;
commit;
SQL
docker exec -e PGPASSWORD=\"\$POSTGRES_ROOT_PASSWORD\" -i cogni-runtime-postgres-1 \
  psql -U \"\$POSTGRES_ROOT_USER\" -d cogni_poly -v ON_ERROR_STOP=1 -P pager=off \
  < /tmp/poly-backfill-grant.sql
rm -f /tmp/poly-backfill-grant.sql"
