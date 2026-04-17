# Handoff: task.0315 Phase 1 — CP2 (Privy Polygon EIP-712 signer)

**Branch:** `design/poly-copy-trade-pr-b` (PR [#890](https://github.com/Cogni-DAO/node-template/pull/890))
**Worktree:** `/Users/derek/dev/cogni-template-poly-copy-trade-pr-b`
**Date:** 2026-04-17
**Status:** CP1 shipped + reviewed APPROVE; CP2 plan at revision 4 (incoming dev's design), ready to code.
**Last commit on branch:** `4e120212` — _docs(poly): task.0315 CP2 revision 4 — use @privy-io/node/viem, delete shim_ (authored by incoming dev)
**Last commit I authored:** `29d2260f4` — _docs(poly): task.0315 CP2 SDK verify-first findings_

---

## Goal (unchanged across devs)

Produce a valid Polymarket CLOB EIP-712 signature from the existing operator Privy wallet, verified via `viem.verifyTypedData`, as CP2's evidence gate. Zero funds, zero gas, zero on-chain state. De-risks CP3 (CLOB adapter placing real orders).

---

## What's shipped on this branch

| Commit                    | What                                                                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ae8991e19` → `bef9a5269` | Design doc revisions (Phase 0 findings, 4-phase plan, reviewer v1/v2 fixes)                                                                                                                                                                                                            |
| `8293eb665`               | **CP1 code** — Run-phase port extension, order domain Zod, `PolymarketOrderSigner` port, `signPolymarketOrder` stub on `OperatorWalletPort` + Privy adapter, paper-adapter skeleton, fake-adapter updates across 4 nodes, 18 new tests. `check:fast` green. Reviewer verdict: APPROVE. |
| `72c8f36ea`               | CP2 plan revision 3 (address design-review REQUEST_CHANGES — OSS envelope + viem-compat shim)                                                                                                                                                                                          |
| `29d2260f4`               | CP2 SDK verify-first findings (Q1: `authorization_context` accepted; Q2: `.signature` response shape)                                                                                                                                                                                  |
| `4e120212`                | **CP2 plan revision 4** (incoming dev) — `@privy-io/node/viem` subpath supersedes the hand-built adapter + shim                                                                                                                                                                        |

---

## The key finding that flipped the plan (revision 3 → 4)

My verify-first research confirmed the raw SDK surface but stopped there. The incoming dev's second pass found `@privy-io/node` ships a first-party viem adapter at `/viem` subpath:

```ts
// node_modules/@privy-io/node/viem.js:38-58 — verbatim
signTypedData: async (typedData) => {
  const { message, domain, types, primaryType } = replaceBigInts(typedData, toHex);
  ...
  const { signature } = await client.wallets().ethereum()
    .signTypedData(walletId, {
      params: { typed_data: { domain, message, primary_type: primaryType, types } },
      ...(authorizationContext ? { authorization_context: authorizationContext } : {}),
    });
  return signature;
}
```

`createViemAccount(client, { walletId, address, authorizationContext })` returns a viem `LocalAccount` that already implements:

- camelCase `primaryType` → snake_case `primary_type` translation
- `authorization_context` passthrough
- `.signature` response unwrap
- the exact shape `@polymarket/clob-client` expects as its signer constructor arg

**This eliminates** the revision 3 deliverables (`signPolymarketOrder` adapter body, `polymarket-signer-shim.ts`, `CHAIN_MISMATCH` guard, shim-reassembly unit tests). CP2 now becomes:

1. `pnpm add -F @cogni/operator-wallet @polymarket/clob-client`
2. Thin wrapper (maybe just a factory function) that constructs the `LocalAccount` from the existing Privy config.
3. Experiment script: `new ClobClient(host, 137, viemAccount).createOrder({...})` dry-run + `viem.verifyTypedData` assertion.

Read the incoming dev's full revision 4 in `work/items/task.0315.poly-copy-trade-prototype.md` (§"CP2 review feedback" + plan bullet at Plan).

---

## Dead surface I created in CP1 (for incoming dev to decide)

Because CP2's plan changed after CP1 shipped, some CP1 surfaces are now vestigial:

| Surface                                                                                       | Fate                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OperatorWalletPort.signPolymarketOrder(typedData)`                                           | Vestigial — `createViemAccount` handles this under the hood. **Incoming dev's note** (rev-4 commit msg) says not to rip out in CP2 (scope), track for CP3 cleanup. |
| `PolymarketOrderSigner` port in `@cogni/market-provider/port/polymarket-order-signer.port.ts` | Vestigial — clob-client's signer contract is `viem.LocalAccount`, not our narrow port. Same CP3 cleanup.                                                           |
| `Eip712TypedData` duplication across `@cogni/market-provider` + `@cogni/operator-wallet`      | Can both be removed when the ports above go.                                                                                                                       |
| Privy adapter stub `signPolymarketOrder` (line 359-366) that throws                           | Still needed until the port itself is removed.                                                                                                                     |
| Four Fake adapter `signPolymarketOrder` stubs                                                 | Same — remove with the port.                                                                                                                                       |

**Tracking recommendation**: don't do this cleanup inside CP2's PR. File a follow-up bug or bundle into CP3's "adapter wiring shrinks" scope. CP1 reviewers APPROVED the current shape; ripping it out in CP2 re-opens review.

---

## Environment access gotchas

- **`.env.local`** lives in main worktree `/Users/derek/dev/cogni-template/.env.local`, NOT in this design worktree. Privy creds (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY`) + the operator EOA address live there. For the live experiment, either:
  - Symlink: `ln -s /Users/derek/dev/cogni-template/.env.local /Users/derek/dev/cogni-template-poly-copy-trade-pr-b/.env.local`
  - Copy: `cp /Users/derek/dev/cogni-template/.env.local /Users/derek/dev/cogni-template-poly-copy-trade-pr-b/.env.local`
- **`.gitignore`** already covers `.env.local` — safe to have in the worktree.
- **Privy wallet** provisioned for Base works identically for Polygon signing — no reprovisioning. Same EOA, different domain chainId.

---

## Pre-push hook gotcha (I hit this twice)

`.husky/pre-push` runs `pnpm check:fast`. The `packages/langgraph-graphs/tests/inproc/mcp-real-server.test.ts` spawns `npx -y @modelcontextprotocol/server-everything` which intermittently times out on cold npm cache or network hiccup — not related to our changes. First push may fail; retry usually succeeds (second attempt uses cached npm package). See the bsat45o12 task log for the specific failure pattern.

Alternative: `git push nt design/poly-copy-trade-pr-b --no-verify` — but CLAUDE.md policy says never skip hooks without explicit user permission, so ask first.

---

## Remote layout quirk

- `origin` → `Cogni-DAO/cogni-template.git`
- `nt` → `Cogni-DAO/node-template.git`
- **PR #890 lives on `nt` (`Cogni-DAO/node-template`)**, not origin.
- Both remotes stay in sync via some repo mirror setup I didn't investigate — pushes to either appear to reach both per `git ls-remote`.
- Always `git push nt design/poly-copy-trade-pr-b` to update PR #890 visibly on GitHub.

---

## Outstanding items checklist (for incoming dev)

- [ ] CP2 code per revision 4 plan (`createViemAccount` wrapper + experiment script)
- [ ] Install `@polymarket/clob-client` (decided in my verify-first findings; incoming dev may reconfirm the exact package version to pin)
- [ ] Live evidence: signature hex + `createOrder` envelope pasted into PR #890 description
- [ ] CP3 scope shrinks — adapter wiring only (no new dep needed, no new ports needed)
- [ ] CP3 cleanup: remove vestigial `signPolymarketOrder` method on wallet port + `PolymarketOrderSigner` port + duplicated `Eip712TypedData` + fake stubs
- [ ] CP4 onwards — original design unchanged

---

## Pointers

- **Work item**: `work/items/task.0315.poly-copy-trade-prototype.md` (full design, all revisions, findings)
- **PR**: https://github.com/Cogni-DAO/node-template/pull/890
- **CP1 review**: see in-conversation summary attached to commit `8293eb665` or the skill's verdict (APPROVE — 8 forward-looking notes)
- **Privy viem subpath**: `node_modules/@privy-io/node/viem.{js,d.ts}`; reference call at `viem.js:38-58`
- **Reviewer REQUEST_CHANGES on CP2 v2 plan**: see task file §"CP2 review feedback (revision 3, 2026-04-17)"
- **Incoming dev's revision 4 task-file section**: search for `revision 4` / commit `4e120212`

---

## What's safe to reuse from my work

- CP1 port/domain types (solid; reviewed APPROVE).
- CP1 Zod schemas (`OrderIntent`, `Fill`, etc.) — these are CLI-like primitives the `decide()` layer in CP4 will consume. Not touched by CP2's revised plan.
- CP1 paper-adapter skeleton (body still lands in P3).
- CP1 `OrderNotSupportedError` — still used by baseline Polymarket Gamma reader + Kalshi.
- My verify-first SDK findings (task file §"CP2 SDK verify-first results") — still factually correct; the incoming dev's finding is a higher layer on top of that plumbing.

## What to throw away

- CP2 revision 3 plan (OSS envelope + viem-compat shim) — superseded by revision 4.
- My draft adapter body sketch in the conversation — not yet committed; don't use it.

---

Good luck — the design worktree is clean, the plan is crisp, and the evidence path is well-defined.
