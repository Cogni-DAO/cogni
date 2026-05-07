---
id: spec.byo-agent-runtime-bridge
type: spec
title: BYO Agent Runtime Bridge — Chat-Integrated Design
status: draft
spec_state: draft
trust: draft
summary: How a local `cogni dev` CLI piping to Claude Code / Codex plugs into the operator's existing assistant-ui chat surface as a `BridgeRuntimeProvider` behind `GraphExecutorPort`, replacing the bespoke `/runtimes/dev` page.
read_when: Implementing or reviewing the bridge runtime, the pairing flow, or any change to the chat model picker / `GraphExecutorPort` namespace map.
implements: []
owner: derekg1729
created: 2026-05-06
verified: null
tags:
  - byo-ai
  - chat
  - graph-executor
  - bridge
  - claude-code
  - codex
---

# BYO Agent Runtime Bridge — Chat-Integrated Design

## Context

`docs/research/byo-agent-runtime-bridge.md` answered "is this possible". The Phase 0 prototype on PR #1280 proved end-to-end pairing via Cloudflare quick tunnel and a bespoke `/runtimes/dev` page. That page is doomed: it bypasses the canonical chat surface (`GraphExecutorPort` → `NamespaceGraphRouter` → assistant-ui Thread) and runs the agent with `cwd = process.cwd()` + the user's real `$HOME`.

## Goal

Plug a locally-running Claude Code or Codex CLI into the operator's existing assistant-ui `/chat` surface as just another model in the picker, with the bridge implemented behind the same `GraphExecutorPort` every other graph runs through. Spec covers the next two phases on the same branch:

- **Phase 1 — Isolation.** `cogni dev` provisions a per-session workspace and spawns the agent with overridden `cwd` + `HOME`. CLI-only change; no operator surface.
- **Phase 2 — Chat-integrated bridge.** A `BridgeRuntimeProvider` (server-side, in the operator) implements `GraphExecutorPort`, registered under namespace `bridge`. Paired devices appear as entries in the existing `/chat` model picker. The browser never sees the tunnel URL. The bespoke page is deleted in the same PR once chat parity is proven.

## Non-Goals

- Tool-call routing into the bridge agent (`tool_call_start` / `tool_call_result`). The CLI is a text producer; assistant-ui's ToolCard primitive simply doesn't fire.
- Multi-turn `stateKey` continuity inside the agent (no `claude --resume` / `codex resume`). Each `/run` is stateless. Future work.
- Container/namespace isolation. Phase 1 is **soft isolation** (`HOME` + `cwd` overrides) — a malicious prompt can still `cat /Users/<u>/.ssh/id_rsa` if the agent has shell access. That's a Phase 4 hardening item; Phase 1 raises the floor, not the ceiling.
- Per-token billing. Bridge runs are funded by the user's own Claude / Codex subscription on their device; the operator emits `usage = undefined` in `GraphFinal` and does not charge platform credits.

## Invariants

- **INV-NO-PARALLEL-CHAT-SURFACE.** No new chat UI ships on the operator. Bridge usage is a pure model-picker entry on the existing `/chat` page; the bespoke `/runtimes/dev` page is deleted in the same PR that ships Phase 2b.
- **INV-NO-TUNNEL-IN-BROWSER.** The browser never sees the device tunnel URL. All dispatch happens server-side, with the operator fetching the tunnel from a server-only AEAD-decrypted connection row.
- **INV-HMAC-AUTH.** Every `/run` dispatch from operator → CLI carries `Authorization: Bearer HMAC(hmacSecret, runId + ts)`. CLI rejects un-signed or stale calls. The shared secret is established once at pair-time and never re-transmitted.
- **INV-SOFT-ISOLATION-ONLY.** Phase 1 isolation is `HOME` + `cwd` env overrides plus an env allowlist. It is **not** a sandbox; absolute-path filesystem access remains. Hard isolation is explicitly Phase 4.
- **INV-AUTH-VIA-SYMLINK.** The user's existing `~/.claude` and `~/.codex` are surfaced into the session dir via symlinks only — the rest of the real `$HOME` is never reachable through `~`.

## Design

```
 ┌─ user laptop ─────────────────────────────┐         ┌─ operator (cognidao.org) ────────────────┐
 │                                           │         │                                          │
 │  cogni dev                                │         │  /chat  (assistant-ui Thread)            │
 │   ├─ ~/.cogni/sessions/<id>/  (cwd+HOME)  │         │   └─ ChatRuntimeProvider                 │
 │   ├─ http://127.0.0.1:<port>              │         │       └─ POST /api/v1/ai/chat            │
 │   └─ cloudflared ─→ https://x.tryc...     │         │           └─ chatCompletionStream()      │
 │                          ▲                │         │               └─ NamespaceGraphRouter    │
 │                          │ HMAC-Bearer    │         │                   └─ "bridge" namespace  │
 │                          │ POST /run      │ ◀───────┤                       │                  │
 │                          │ SSE stdout/done│ Cloudflare quick tunnel        ▼                  │
 │                          │                │         │              BridgeRuntimeProvider       │
 │                          └────────────────┼─────────┤                       │                  │
 │                                           │         │              connections (AEAD blob)     │
 └───────────────────────────────────────────┘         └──────────────────────────────────────────┘
```

### Request flow (chat → local agent)

1. User opens `/chat`, picks a paired device from the model picker. `ModelRef = { providerKey: "bridge", modelId: "<deviceName>:<runtime>", connectionId: <conn-uuid> }`.
2. `ChatRuntimeProvider.client.tsx:164` posts `{ message, modelRef, graphName, stateKey? }` to `/api/v1/ai/chat`.
3. Chat completions facade ([completion.server.ts:317](nodes/operator/app/src/app/_facades/ai/completion.server.ts)) sees `modelRef.providerKey === "bridge"` and overrides `graphName = "bridge:default"` server-side. Client never selects a "bridge graph"; the model carries the routing.
4. `NamespaceGraphRouter.runGraph` ([namespace-graph-router.ts:77](packages/graph-execution-host/src/routing/namespace-graph-router.ts)) splits on `:`, dispatches to `BridgeRuntimeProvider`.
5. `BridgeRuntimeProvider` resolves `connectionId` → AEAD-decrypts the connection row → reads `{ tunnelUrl, hmacSecret }`. Server-side fetches `POST <tunnelUrl>/run` with `Authorization: Bearer <hmac-of-runId>` and body `{ prompt: <flattened-messages>, runtime: <runtime>, runId }`.
6. CLI verifies HMAC, spawns agent in `~/.cogni/sessions/<id>/`, streams SSE chunks back.
7. `BridgeRuntimeProvider` translates each `{stream, data}` SSE event into `AiEvent` envelopes, yielded into the `AsyncIterable<AiEvent>` consumed by the chat route's SSE writer. Browser sees streaming tokens through assistant-ui's ordinary text-delta path.

### Wire-format translation

| CLI SSE event ([server.ts:186](packages/cogni-cli/src/dev/server.ts)) | `AiEvent` ([ai-events.ts:145](packages/ai-core/src/events/ai-events.ts))  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `{type: "stdout", data}`                                              | `{type: "text_delta", delta: data}`                                       |
| `{type: "stderr", data}`                                              | logged at provider; **not** emitted to chat (kept out of message stream)  |
| `{type: "done", code: 0}`                                             | `{type: "assistant_final", content: <accumulated>}` then `{type: "done"}` |
| `{type: "done", code: !=0}`                                           | `{type: "error", error: "internal"}` then `{type: "done"}`                |

`GraphFinal` resolves with `{ ok, runId, requestId, content?, usage: undefined }`. No tool events, no usage report — accepted gaps for v1.

### Pairing & auth

Single one-time pairing, then per-session re-announce:

1. **Pair (one-time, browser-driven).**
   - Operator UI: "Pair a local device" button on a Settings → Devices page (or under the Models page). Generates a one-time pairing code (`pair_<uuid>`) tied to the current session user. Stored in a short-TTL `bridge_pairing_codes` table or Redis-equivalent (cache only).
   - User runs `cogni dev pair <code>` on their laptop. CLI POSTs `{ code, deviceName }` to `/api/v1/runtimes/pair`. Operator validates the code (single-use, 5-min TTL), generates a 32-byte `hmacSecret`, AEAD-encrypts `{ deviceName, hmacSecret, runtimes: [...] }`, inserts into `connections` (`provider="cogni-bridge-device"`, `credentialType="bridge-pairing"`).
   - Operator returns `{ connectionId, hmacSecret }` to the CLI. CLI persists to `~/.cogni/devices.json`.
2. **Announce (every `cogni dev` startup).**
   - CLI starts local server + tunnel, then POSTs `/api/v1/runtimes/announce` with `{ connectionId, tunnelUrl, signature: HMAC(hmacSecret, tunnelUrl + ts) }`.
   - Operator updates the connection's `encryptedCredentials.lastTunnelUrl` + `lastUsedAt`.
3. **Dispatch auth (per `/run` call from operator).**
   - `BridgeRuntimeProvider` signs the run: `Authorization: Bearer HMAC(hmacSecret, runId + ts)`.
   - CLI rejects un-signed or stale calls (timestamp window: 5 min).
4. **Revocation.** User clicks "Remove device" in the operator UI → sets `connections.revokedAt`. Future dispatches fail with a clear error; CLI's local secret is now useless.

Why HMAC, not OAuth: the operator and the CLI share a secret created at pair-time. There's no third-party authority. HMAC is the right tool — same shape as the existing `cogni_ag_sk_v1_*` agent tokens.

### Isolation (Phase 1)

A spawned `claude` / `codex` runs as the user's UID with full filesystem access. Phase 1 reduces blast radius via env-var hygiene; it is **not** a sandbox.

- `~/.cogni/sessions/<sessionId>/` is created on `cogni dev` startup (`sessionId = randomUUID()`), removed on graceful shutdown.
- Spawn env: `cwd = sessionDir`, `HOME = sessionDir`, `PATH` preserved (so the binary resolves), `USER` preserved. Everything else pruned to an explicit allowlist (`SHELL`, `TERM`, `LANG`, `LC_*`, `TMPDIR`).
- Anthropic / OpenAI auth flows: claude reads `~/.claude/`, codex reads `~/.codex/`. With `HOME=sessionDir`, those paths become `sessionDir/.claude` etc. — empty. To preserve the user's existing local auth, `cogni dev` symlinks `<sessionDir>/.claude → $REAL_HOME/.claude` and `<sessionDir>/.codex → $REAL_HOME/.codex` if those exist, before spawning. (Symlinks bridge the auth without exposing the rest of `$HOME`.)
- `--workdir <path>` flag stays available as an opt-out for advanced users who want the agent to operate on a real repo. Default is the sandboxed session dir.

Escape test (proves the floor): a prompt of `cat ~/.ssh/id_rsa` is unable to read the user's real SSH key when run with default isolation, because `~` resolves to the empty session dir. The test asserts the agent's stdout contains neither key material nor a "Permission denied on path containing /Users/<u>". Note this test does NOT assert hard sandbox containment — `cat /Users/<u>/.ssh/id_rsa` (absolute path) still works, and that's an acknowledged Phase 4 follow-up.

### Model catalog integration

`/api/v1/ai/models` ([model-catalog.server.ts:65](nodes/operator/app/src/shared/ai/model-catalog.server.ts)) currently returns LiteLLM-driven models. Extend it: after the LiteLLM list resolves, fetch the current user's active bridge connections and synthesize one `ModelMeta` per device-runtime pair:

```ts
{
  id: `bridge:${deviceName}:${runtime}`,           // unique modelId
  name: `${runtime} on ${deviceName}`,
  isFree: true,                                     // user funds their own subscription
  isZdr: false,
  providerKey: "bridge",
  cogni: {},
}
```

The chat view ([chat/view.tsx:133](<nodes/operator/app/src/app/(app)/chat/view.tsx>)) already builds `ModelRef` from server-emitted `model.ref`. Add `connectionId` to the emitted ref so the API route can look up the device on dispatch. ModelPicker groups by `providerKey`, so paired devices land in their own section automatically.

If the device's most-recent `lastTunnelUrl` is stale (>10 min since `announce`), the catalog still emits the model but tags it `online: false` so the picker can grey it out.

## Implementation order

PRs all stack on `derekg1729/byo-agent-research` (PR #1280 stays open).

1. **Phase 1 — isolation in `@cogni/cli`.** Single-package change. Test: spawn an `echo HOME=$HOME` agent shim, assert the value is the session dir. No operator change.
2. **Phase 2a — `BridgeRuntimeProvider` registration.** Adapter file in `nodes/operator/app/src/adapters/server/ai/bridge/`. Translates SSE → AiEvent. Registered in `bootstrap/graph-executor.factory.ts:114` under namespace `bridge`. Stand-alone unit test against a fake CLI server.
3. **Phase 2b — pairing + announce + model catalog wiring.** New `connections` provider (`"cogni-bridge-device"`), `/api/v1/runtimes/{pair,announce}` routes, `cogni dev pair` subcommand, model catalog extension, chat completions facade override (`graphName = "bridge:default"` when `providerKey === "bridge"`).
4. **Cleanup.** Delete `nodes/operator/app/src/app/(app)/runtimes/`. The git history preserves the demo for reproducibility.

Until step 4, `/runtimes/dev` stays as the working demo so we can A/B against the chat-integrated path.

## Code touch points

### New files

- `packages/cogni-cli/src/dev/session.ts` — Phase 1: provision/teardown session dir, build env allowlist
- `packages/cogni-cli/src/dev/pair.ts` — Phase 2b: `cogni dev pair <code>`, persist to `~/.cogni/devices.json`
- `packages/cogni-cli/src/dev/announce.ts` — Phase 2b: post `/announce` on startup
- `nodes/operator/app/src/adapters/server/ai/bridge/bridge-runtime.provider.ts` — Phase 2a
- `nodes/operator/app/src/app/api/v1/runtimes/pair/route.ts` — Phase 2b
- `nodes/operator/app/src/app/api/v1/runtimes/announce/route.ts` — Phase 2b

### Edits

- `packages/cogni-cli/src/dev/index.ts` — call `session.provision()`, pass through to `runtime.runOnce`
- `packages/cogni-cli/src/dev/runtime.ts:106` — accept `cwd`, `homeDir`, sanitized `env`; replace direct `process.cwd()` reliance
- `packages/cogni-cli/src/dev/server.ts:151` — verify `Authorization: Bearer` HMAC, use session env when spawning
- `packages/db-schema/src/connections.ts:38` — add `"cogni-bridge-device"` to provider whitelist
- `nodes/operator/app/src/bootstrap/graph-executor.factory.ts:104` — `providers.set("bridge", ...)`
- `nodes/operator/app/src/shared/ai/model-catalog.server.ts` — append paired-device entries
- `nodes/operator/app/src/app/_facades/ai/completion.server.ts:333` — `graphName` override for `providerKey === "bridge"`

## Open questions

- **Operator host for tunnels.** Today: Cloudflare quick tunnel, no auth on the CLI side beyond CORS. Phase 2 adds HMAC, which is the right primitive. Future: replace with Cogni-owned reverse-tunnel (Tailscale headscale, Cloudflare named tunnel) so device URLs are stable and we don't depend on an unauthenticated cloudflared trycloudflare.com URL.
- **Where does the pairing UI live?** Initially under `/settings/devices` (new sub-page) — keeps the cleanup of `/runtimes/dev` clean. Open: do paired devices need their own list view, or fold into the model picker's "manage" affordance?
- **Concurrent runs.** v1: one in-flight `/run` per device (CLI is single-process). The provider must serialize or 409 if a second arrives. Sufficient for solo-dev MVP.

## References

- Research: `docs/research/byo-agent-runtime-bridge.md`
- Port contract: [`packages/graph-execution-core/src/graph-executor.port.ts:117`](packages/graph-execution-core/src/graph-executor.port.ts)
- Router: [`packages/graph-execution-host/src/routing/namespace-graph-router.ts:77`](packages/graph-execution-host/src/routing/namespace-graph-router.ts)
- Bootstrap: [`nodes/operator/app/src/bootstrap/graph-executor.factory.ts:89`](nodes/operator/app/src/bootstrap/graph-executor.factory.ts)
- AiEvent union: [`packages/ai-core/src/events/ai-events.ts:145`](packages/ai-core/src/events/ai-events.ts)
- Connections schema: [`packages/db-schema/src/connections.ts:58`](packages/db-schema/src/connections.ts)
- Chat runtime: [`nodes/operator/app/src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx:159`](nodes/operator/app/src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx)
