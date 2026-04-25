#!/usr/bin/env bash
# Re-snapshot the poly CTF redeem fixtures against current Polymarket Data-API
# + Polygon mainnet CTF reads. Pinned to a block for reproducibility. Run when:
#   - the test funder's positions change in a way the predicate must cover
#   - the CTF contract address or function selectors change
#   - you're adding a new scenario the existing snapshot doesn't represent
#
# Requires: POLYGON_RPC_URL env var; jq; python3.
#
# Outputs three sibling files (same dir as this script):
#   positions.data-api.snapshot-<DATE>.json   raw Data-API response
#   ctf-reads.snapshot-<DATE>.json            on-chain reads at pinned block
#   expected-decisions.snapshot-<DATE>.json   golden decision table

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADDR="${POLY_TEST_FUNDER:-0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134}"
CTF="0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"
RPC="${POLYGON_RPC_URL:?set POLYGON_RPC_URL}"
DATE="$(date -u +%Y-%m-%d)"

POS_FILE="$DIR/positions.data-api.snapshot-$DATE.json"
CTF_FILE="$DIR/ctf-reads.snapshot-$DATE.json"
DEC_FILE="$DIR/expected-decisions.snapshot-$DATE.json"

echo "snapshotting funder=$ADDR date=$DATE"
curl -sf "https://data-api.polymarket.com/positions?user=$ADDR&sizeThreshold=0.01&limit=200" > "$POS_FILE"
echo "  positions: $(jq length "$POS_FILE")"

LATEST_HEX=$(curl -s -X POST "$RPC" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}' | jq -r .result)
echo "  pinned block: $((16#${LATEST_HEX#0x})) ($LATEST_HEX)"

POSITIONS_FILE="$POS_FILE" CTF_OUT="$CTF_FILE" RPC="$RPC" CTF="$CTF" ADDR="$ADDR" BLOCK="$LATEST_HEX" python3 - <<'PY'
import json, os, urllib.request
RPC, CTF, ADDR, BLOCK = os.environ['RPC'], os.environ['CTF'], os.environ['ADDR'], os.environ['BLOCK']
SEL_NUM = '0x0504c814'   # payoutNumerators(bytes32,uint256)
SEL_DEN = '0xdd34de67'   # payoutDenominator(bytes32)
SEL_GOSC = '0xd42dc0c2'  # getOutcomeSlotCount(bytes32)
SEL_BAL = '0x00fdd58e'   # balanceOf(address,uint256)
def call(to, data):
    req = urllib.request.Request(RPC, data=json.dumps({'jsonrpc':'2.0','method':'eth_call','id':1,'params':[{'to':to,'data':data},BLOCK]}).encode(), headers={'Content-Type':'application/json'})
    r = json.loads(urllib.request.urlopen(req).read())
    if r.get('result') is None:
        return None
    return int(r['result'], 16)
positions = json.load(open(os.environ['POSITIONS_FILE']))
reads = []
for p in positions:
    cid = p['conditionId']
    cid_hex = (cid[2:] if cid.startswith('0x') else cid).zfill(64)
    asset = int(p['asset'])
    opp_asset = int(p['oppositeAsset']) if p.get('oppositeAsset') else None
    held_idx = int(p['outcomeIndex'])
    other_idx = 1 - held_idx if held_idx in (0,1) else None
    den = call(CTF, SEL_DEN + cid_hex)
    slots = call(CTF, SEL_GOSC + cid_hex)
    num_held = call(CTF, SEL_NUM + cid_hex + format(held_idx, '064x'))
    num_other = call(CTF, SEL_NUM + cid_hex + format(other_idx, '064x')) if other_idx is not None else None
    addr_padded = ADDR.lower()[2:].zfill(64)
    bal_held = call(CTF, SEL_BAL + addr_padded + format(asset, '064x'))
    bal_opp = call(CTF, SEL_BAL + addr_padded + format(opp_asset, '064x')) if opp_asset is not None else None
    reads.append({
        'conditionId': p['conditionId'], 'title': p['title'], 'negativeRisk': p['negativeRisk'],
        'outcomeIndex': held_idx, 'outcome': p['outcome'],
        'asset': p['asset'], 'oppositeAsset': p.get('oppositeAsset'),
        'dataApi': {'redeemable': p['redeemable'], 'curPrice': p['curPrice'], 'size': p['size'], 'cashPnl': p['cashPnl']},
        'ctf': {'outcomeSlotCount': slots, 'payoutDenominator': den,
                'payoutNumerator_heldIdx': num_held, 'payoutNumerator_otherIdx': num_other,
                'balanceOf_funder_heldAsset': bal_held, 'balanceOf_funder_oppositeAsset': bal_opp},
    })
out = {
    '_meta': {
        'snapshot': BLOCK, 'funder': ADDR, 'ctfContract': CTF, 'chainId': 137,
        'block': int(BLOCK, 16), 'blockHex': BLOCK,
        'dataApiSource': f'https://data-api.polymarket.com/positions?user={ADDR}&sizeThreshold=0.01&limit=200',
        'selectors': {
            'payoutNumerators(bytes32,uint256)': SEL_NUM, 'payoutDenominator(bytes32)': SEL_DEN,
            'getOutcomeSlotCount(bytes32)': SEL_GOSC, 'balanceOf(address,uint256)': SEL_BAL,
        },
    },
    'positions': reads,
}
json.dump(out, open(os.environ['CTF_OUT'], 'w'), indent=2)
PY
echo "  CTF reads: $(jq '.positions | length' "$CTF_FILE")"

CTF_FILE="$CTF_FILE" DEC_FILE="$DEC_FILE" python3 - <<'PY'
import json, os
src = json.load(open(os.environ['CTF_FILE']))
def decision(p):
    bal = p['ctf']['balanceOf_funder_heldAsset']; num = p['ctf']['payoutNumerator_heldIdx']
    if bal is None or num is None: return ('skip','read_failed')
    if bal == 0: return ('skip','zero_balance')
    if num == 0: return ('skip','losing_outcome')
    return ('redeem', None)
rows = []
for p in src['positions']:
    act, reason = decision(p)
    rows.append({
        'conditionId': p['conditionId'], 'asset': p['asset'], 'outcomeIndex': p['outcomeIndex'],
        'negativeRisk': p['negativeRisk'], 'title': p['title'],
        'inputs': {
            'balanceOf_funder_heldAsset': p['ctf']['balanceOf_funder_heldAsset'],
            'payoutNumerator_heldIdx': p['ctf']['payoutNumerator_heldIdx'],
            'payoutDenominator': p['ctf']['payoutDenominator'],
        },
        'expected': {'action': act, 'skipReason': reason},
        'oracle': {
            'dataApiCurPrice': p['dataApi']['curPrice'], 'dataApiCashPnl': p['dataApi']['cashPnl'],
            'dataApiRedeemable': p['dataApi']['redeemable'],
        },
    })
summary = {'total': len(rows), 'byAction': {}, 'byNegRisk': {}, 'winnersDetected': []}
for r in rows:
    a = r['expected']['action']
    summary['byAction'][a] = summary['byAction'].get(a, 0) + 1
    key = f"{'true' if r['negativeRisk'] else 'false'}_{a}"
    summary['byNegRisk'][key] = summary['byNegRisk'].get(key, 0) + 1
    if a == 'redeem': summary['winnersDetected'].append(r['title'])
out = {
    '_meta': {**src['_meta'],
              'description': 'Predicate decision table: balanceOf>0 AND payoutNumerator(heldIdx)>0 → redeem. Snapshotted from real Polygon mainnet reads; tests must reproduce exactly.'},
    'summary': summary, 'cases': rows,
}
json.dump(out, open(os.environ['DEC_FILE'], 'w'), indent=2)
PY
echo "  decisions: $(jq '.summary.total' "$DEC_FILE") cases  ($(jq -r '.summary.byAction | to_entries | map("\(.key)=\(.value)") | join(", ")' "$DEC_FILE"))"
echo ""
echo "Wrote:"
echo "  $POS_FILE"
echo "  $CTF_FILE"
echo "  $DEC_FILE"
