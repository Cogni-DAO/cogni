#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# spike.5024 — empirical Polymarket backfill probe
# Purpose: re-run the rate / volume / pagination experiments documented in
#   docs/research/poly/backfill-spike-2026-05-05.md
# Public Data API only; no auth, no writes.

set -euo pipefail

RN1=0x2005d16a84ceefa912d4e380cd32e7ff827875ea
SWISSTONY=0x204f72f35326db932158cba6adff0b9a1da95e14
NOW=$(python3 -c 'import time; print(int(time.time()))')
OUT=${OUT:-/tmp/poly-backfill-probe}
mkdir -p "$OUT"

now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

echo "## [1] /activity?type=TRADE&limit=500 — single page latency for both wallets"
for W in "$RN1" "$SWISSTONY"; do
  T1=$(now_ms)
  curl -sS "https://data-api.polymarket.com/activity?user=$W&type=TRADE&limit=500" -o "$OUT/p0_${W}.json"
  T2=$(now_ms)
  N=$(python3 -c "import json; print(len(json.load(open('$OUT/p0_${W}.json'))))")
  echo "  ${W}: ${N} rows in $((T2-T1))ms"
done

echo
echo "## [2] historical rate sampling (RN1 + swisstony)"
for W in "$RN1" "$SWISSTONY"; do
  echo "  --- $W"
  for OFFSET_DAYS in 0 30 90 180 360; do
    END=$((NOW - OFFSET_DAYS * 86400))
    curl -sS "https://data-api.polymarket.com/activity?user=$W&type=TRADE&end=$END&limit=500" -o "$OUT/sample_${OFFSET_DAYS}.json"
    python3 - <<PY
import json, datetime
d = json.load(open("$OUT/sample_${OFFSET_DAYS}.json"))
if not d:
    print(f"    {$OFFSET_DAYS:>4}d ago: no trades (wallet predates this window)"); raise SystemExit
first, last = d[0]['timestamp'], d[-1]['timestamp']
span = max(first - last, 1)
rate = $OFFSET_DAYS and round(len(d) / span * 86400)
human = datetime.datetime.fromtimestamp(last, datetime.UTC).strftime('%Y-%m-%d')
print(f"    {$OFFSET_DAYS:>4}d ago: {len(d)} trades over {span/3600:.2f}hr around {human} -> {rate}/day")
PY
  done
done

echo
echo "## [3] concurrency safety — 30 parallel /activity?limit=10"
T1=$(now_ms)
for i in $(seq 1 30); do
  ( curl -sS -o /dev/null -w "%{http_code}\n" "https://data-api.polymarket.com/activity?user=$RN1&type=TRADE&limit=10&offset=$((i*10))" >> "$OUT/burst.log" ) &
done
wait
T2=$(now_ms)
OK=$(grep -c "^200" "$OUT/burst.log" || true)
TOT=$(wc -l < "$OUT/burst.log" | tr -d ' ')
echo "  30 parallel in $((T2-T1))ms: ok=$OK total=$TOT"
> "$OUT/burst.log"

echo
echo "## [4] Gamma /markets — single + array form"
COND=$(python3 -c "import json; print(json.load(open('$OUT/p0_${RN1}.json'))[0]['conditionId'])")
T1=$(now_ms)
curl -sS "https://gamma-api.polymarket.com/markets?condition_ids=$COND" -o "$OUT/gamma1.json"
T2=$(now_ms)
echo "  single condition_ids=$COND -> $((T2-T1))ms, $(python3 -c 'import json; d=json.load(open("'"$OUT"'/gamma1.json")); print(len(d))') markets"

# Array form (repeated condition_ids params) — known capped at ~24
ARGS=$(python3 -c "
import json
d=json.load(open('$OUT/p0_${RN1}.json'))
seen=set()
for r in d:
  c=r.get('conditionId')
  if c and c not in seen: seen.add(c)
  if len(seen)>=20: break
print('&'.join(f'condition_ids={c}' for c in seen))
")
T1=$(now_ms)
curl -sS "https://gamma-api.polymarket.com/markets?$ARGS&limit=500" -o "$OUT/gamma_batch.json"
T2=$(now_ms)
N_BATCH=$(python3 -c 'import json; print(len(json.load(open("'"$OUT"'/gamma_batch.json"))))')
echo "  array form (20 condition_ids): $N_BATCH markets in $((T2-T1))ms"

echo
echo "Output written to $OUT/"
