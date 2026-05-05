#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# spike.5024 — parallel monthly-window walker orchestrator.
# Splits a wallet's lifetime into N windows and runs one walk.ts per window
# in parallel; collapses NDJSON outputs into one sorted file at the end.
#
# Usage:
#   walk-windows.sh --wallet RN1 --start 2026-04-01 --end 2026-05-05 --windows 4
#
# Env passthrough: PNPM_HOME / NODE for tsx execution.

set -euo pipefail

WALLET="RN1"
START_DATE=""
END_DATE=""
WINDOWS=4
OUT_BASE="/tmp/poly-backfill"
MAX_PAGES_PER_WINDOW=1000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wallet) WALLET="$2"; shift 2;;
    --start)  START_DATE="$2"; shift 2;;
    --end)    END_DATE="$2"; shift 2;;
    --windows) WINDOWS="$2"; shift 2;;
    --out)    OUT_BASE="$2"; shift 2;;
    --max-pages-per-window) MAX_PAGES_PER_WINDOW="$2"; shift 2;;
    *) echo "unknown arg $1" >&2; exit 1;;
  esac
done

if [[ -z "$START_DATE" || -z "$END_DATE" ]]; then
  echo "usage: $0 --wallet <key> --start YYYY-MM-DD --end YYYY-MM-DD [--windows N] [--out DIR] [--max-pages-per-window N]" >&2
  exit 1
fi

START_TS=$(python3 -c "import datetime; print(int(datetime.datetime.fromisoformat('$START_DATE').timestamp()))")
END_TS=$(python3 -c "import datetime; print(int(datetime.datetime.fromisoformat('$END_DATE').timestamp()))")
TOTAL_SPAN=$((END_TS - START_TS))
WINDOW_SPAN=$((TOTAL_SPAN / WINDOWS))

OUT_DIR="$OUT_BASE/${WALLET}-$(date +%s)"
mkdir -p "$OUT_DIR"
echo "[walk-windows] wallet=$WALLET out=$OUT_DIR  span ${START_DATE}..${END_DATE}  windows=$WINDOWS  ~${WINDOW_SPAN}s/window"

cd "$(dirname "$0")/../../.."

PIDS=()
for i in $(seq 0 $((WINDOWS - 1))); do
  WSTART=$((START_TS + i * WINDOW_SPAN))
  WEND=$((START_TS + (i + 1) * WINDOW_SPAN))
  if [[ "$i" -eq $((WINDOWS - 1)) ]]; then WEND=$END_TS; fi
  LOG="$OUT_DIR/window-$i.log"
  WIN_OUT="$OUT_DIR/win$i"
  pnpm tsx scripts/experiments/poly-backfill/walk.ts \
    --wallet "$WALLET" \
    --start "$WSTART" --end "$WEND" \
    --max-pages "$MAX_PAGES_PER_WINDOW" \
    --out "$WIN_OUT" >"$LOG" 2>&1 &
  PIDS+=($!)
  echo "  [$i] PID=${PIDS[$i]} window=$WSTART..$WEND log=$LOG"
done

FAIL=0
for PID in "${PIDS[@]}"; do
  if ! wait "$PID"; then FAIL=$((FAIL + 1)); fi
done

echo
echo "[walk-windows] all walkers exited (failures=$FAIL)"

# Collapse: cat all per-window NDJSONs sorted by timestamp DESC, dedupe by tx:asset:side
COMBINED="$OUT_DIR/${WALLET}-fills.ndjson"
python3 - <<PY
import json, glob, os
seen = set()
out_path = "$COMBINED"
n_in, n_out = 0, 0
with open(out_path, "w") as fout:
    paths = sorted(glob.glob("$OUT_DIR/win*/*-fills.ndjson"))
    rows = []
    for p in paths:
        with open(p) as f:
            for line in f:
                if not line.strip(): continue
                n_in += 1
                r = json.loads(line)
                k = f"{r.get('transactionHash')}:{r.get('asset')}:{r.get('side')}"
                if k in seen: continue
                seen.add(k)
                rows.append(r)
    rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)
    for r in rows:
        fout.write(json.dumps(r) + "\n")
        n_out += 1
print(f"[collapse] {n_in} input rows -> {n_out} unique rows in {out_path}")
PY

echo "[walk-windows] done -> $COMBINED"
