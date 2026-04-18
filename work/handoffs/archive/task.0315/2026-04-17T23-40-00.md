---
id: task.0315.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-17
updated: 2026-04-17
branch: feat/poly-copy-trade-cp4
worktree: /Users/derek/dev/cogni-template-cp4
last_commit: 21bc70747
---

# Handoff: task.0315 Phase 1 CP4.25 — validation + closeout

**Branch:** `feat/poly-copy-trade-cp4` (PR [#900](https://github.com/Cogni-DAO/node-template/pull/900))
**Worktree:** `/Users/derek/dev/cogni-template-cp4`
**State:** all code written, `pnpm check` green, review in flight. The remaining work is **candidate-a validation + closeout**, not code.

Previous CP3 handoff archived at `work/handoffs/archive/task.0315/2026-04-17T16-00-00.md`.

## Where it stands

```
🟢 CP4.1   pure decide() + Polymarket Data-API normalizer       63f9f0868   on origin
🟢 CP4.2   createClobExecutor(deps) with injected placeOrder    33288f220   on origin
🟢 CP4.25  core__poly_place_trade agent-callable AI tool        21bc70747   on origin
⚪ CP4.3   autonomous copy-trade loop (poll + fills/decisions writes, kill-switch read)
⚪ CP4.5   read-only dashboard activity card
```

PR #900 carries CP4.1 + CP4.2 + CP4.25. **No autonomy loop, no DB writes, no admin ops route** — an agent chatting with poly-brain can invoke `core__poly_place_trade` and get a real CLOB `order_id` back. That's the entire merge gate.

## What a validation pass looks like on candidate-a

Merge gate: **one registered agent places one real `order_id`, captured in Loki + visible on Polymarket, pasted into the PR.**

1. Deploy PR #900 to candidate-a. Verify bootstrap logs show either:
   - `poly.trade.capability.unavailable` (with `has_operator_wallet`/`has_clob_creds`/`has_privy` flags — use these to debug missing env), or
   - No log yet — the capability is lazy; the first log is `poly.trade.capability.ready` on the first tool invocation with `wallet_id` + resolved `address`.
2. From a registered agent chat session, message poly-brain:
   > "Place a $5 BUY at 0.99 on Polymarket market `<conditionId>` outcome Yes, tokenId `<tokenId>`."
   > Pick a conditionId / tokenId from `core__wallet_top_traders` output or an external reference. Keep size ≤ 25 USDC (zod cap); standard markets enforce ~$1 min, neg-risk ~$5.
3. Agent response should include:
   - `order_id` (0x-prefixed hex, matches PolymarketClobAdapter response)
   - `status`: `open` / `filled` / `matched`
   - `profile_url`: `https://polymarket.com/profile/0xdcca8d85603c2cc47dc6974a790df846f8695056`
4. Confirm on Polymarket that the position is live under the operator EOA.
5. Paste `{order_id, profile_url, transaction_hash_if_matched, agent name / session id}` into PR #900 as the evidence block.
6. Update `task.0315` → `status: needs_closeout`, run `/closeout` for the final doc pass.

## Secrets propagation for candidate-a — **the `/env-update` skill is stale here**

`.claude/commands/env-update.md` still describes the legacy deploy model (production/staging-preview GitHub workflows + `scripts/ci/deploy.sh` to a VM over SSH). That path was superseded by the **k3s + Argo CD + candidate flighting** model (see `/deploy-node` and `/deploy-operator` skills — those are current).

**What the skill gets wrong for our current setup:**

- References `.github/workflows/deploy-production.yml` + `deploy.sh` SSH-based provisioning — **not how candidate-a + canary + production flight today.**
- Tells you to mount env into `docker-compose.dev.yml` + `docker-compose.yml` — still useful for local `pnpm dev:stack`, but the candidate-a deployment path is k8s.
- Missing: how secrets get from GitHub → k3s sealed secrets / external-secrets operator → the poly Deployment.

**What to actually do for CP4.25 on candidate-a (until the skill is rewritten):**

The new env vars live at `nodes/poly/app/src/shared/env/server-env.ts`:

```
OPERATOR_WALLET_ADDRESS   already used by CP3.1 allowance script + CP3.2 dress
                          rehearsal — should already exist on candidate-a
POLY_CLOB_API_KEY         new — derived via scripts/experiments/derive-polymarket-api-keys.ts
POLY_CLOB_API_SECRET      new
POLY_CLOB_PASSPHRASE      new
POLY_CLOB_HOST            optional; omit for prod CLOB

PRIVY_APP_ID              already wired; confirm presence
PRIVY_APP_SECRET          already wired; confirm presence
PRIVY_SIGNING_KEY         already wired; confirm presence
```

Propagation checklist for the current k3s + Argo CD flighting model:

- [ ] **`.env.local`** in both worktrees (`cogni-template` + `cogni-template-cp4`): POLY*CLOB*\* populated for local dev + stack tests.
- [ ] **`.env.test`** + **`.env.local.example`**: mock / placeholder values for CI + fresh clones.
- [ ] **`.github/workflows/ci.yaml`**: every `env:` block that already references `PRIVY_APP_ID` or similar — add the three POLY*CLOB*\* entries with test-safe values. Check the `static`, `component`, `contract`, `stack` jobs specifically.
- [ ] **Candidate-a k8s secret**: `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_PASSPHRASE` need to land in the poly app's k8s Secret on candidate-a. **Confirm the mechanism with the `/deploy-node` skill or whoever owns candidate-a provisioning** — this is the exact thing `/env-update` is stale on. Options depending on how the cluster is set up:
  - SealedSecrets (`kubeseal`) committed to the cluster config repo
  - External-secrets operator pulling from a secrets backend (GitHub, Doppler, etc.)
  - Direct `kubectl create secret` on the cluster (one-shot, not GitOps-friendly)
- [ ] **poly Deployment spec** (`infra/k8s/overlays/candidate-a/poly/`): ensure the container's `env:` / `envFrom:` references the new Secret keys.
- [ ] **Sanity**: `kubectl exec` into the running poly pod post-deploy and `env | grep POLY_CLOB` — verifies the env actually landed.
- [ ] **Add a work item** to rewrite `/env-update` for the k3s + Argo CD flighting model. It's the canonical "I added an env var, where do I put it?" guide and silently misleading devs now.

**Non-blocker reminder:** the capability is lazy. Even if POLY*CLOB*\* is misconfigured, the pod boots fine; the tool registers as a stub that throws `core__poly_place_trade stub invoked` on invocation. No crashloop, no silent 500 — just a clear chat-surfaced error with the exact env vars to check.

## Gotchas worth knowing

- **OPERATOR_WALLET_ADDRESS is already the Polymarket signer** — no alias needed (this was in the CP4.25 design review as "POLY_OPERATOR_WALLET_ADDRESS?"). The wallet `0xdCCa8…5056` is on-chain funded + approved from CP3.1.
- **viem dual-peerDep `as any` casts** in `bootstrap/capabilities/poly-trade.ts` lines 349–360 — not a bug, cross-peerDep type drift between `@privy-io/node/viem` and our app's viem. Same wiring that works live in `scripts/experiments/fill-market.ts`. Do NOT try to remove them without upgrading both sides atomically.
- **First tool invocation is slow** — dynamic import of `@polymarket/clob-client` + Privy wallet resolution. ~1–3s first call, <100ms subsequent. Expected; do not panic.
- **Biome `noRestrictedImports` on clob-client** — if CP4.3 or a follow-up ever needs a second importer of `@polymarket/clob-client`, extend the exception list in `biome/app.json`. Do NOT statically import it anywhere else; the containment is load-bearing for non-trader code paths in future pods.
- **Prompt gate is soft** — the LLM is instructed to only call `core__poly_place_trade` on explicit user request with concrete params. A bad actor with chat access can still cajole it. The hard guardrails are: (a) 25 USDC max per trade (zod), (b) operator EOA balance cap (~20 USDC today), (c) kill the tool by removing one of the POLY*CLOB*\* env vars (capability becomes stub). CP4.3's kill-switch row + cap enforcement are future hardening.
- **19 new tests + ~1234 total workspace tests pass.** Full `pnpm check` green on `21bc70747`.

## Pointers

```
PR                       https://github.com/Cogni-DAO/node-template/pull/900
Tool                     packages/ai-tools/src/tools/poly-place-trade.ts
Capability factory       nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts
Env schema               nodes/poly/app/src/shared/env/server-env.ts
Biome import guard       biome/app.json (noRestrictedImports on @polymarket/clob-client)
Poly-brain tool list     nodes/poly/graphs/src/graphs/poly-brain/tools.ts
Poly-brain system prompt nodes/poly/graphs/src/graphs/poly-brain/prompts.ts
Task doc                 work/items/task.0315.poly-copy-trade-prototype.md
Stale env skill          .claude/commands/env-update.md  ← needs rewrite for k3s + Argo CD
Deploy skills (current)  .claude/commands/deploy-node.md, deploy-operator.md
```

## Next command for the incoming dev

1. Review PR #900. Push back on anything in the architecture notes or merge-gate framing above.
2. Propagate secrets to candidate-a per the checklist above. File a work item to rewrite `/env-update`.
3. Drive the validation: single agent chat session → real `order_id` → paste evidence into PR #900.
4. Once evidence lands: `/closeout` for doc pass + final merge.
5. Afterward: CP4.3 (autonomy loop) and CP4.5 (dashboard card) are queued. CP4.3 reuses `container.copyTradeCapability.placeTrade` directly — no new adapter wiring.
