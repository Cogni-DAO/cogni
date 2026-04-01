---
id: bug.0232
type: bug
title: "LlmService port silently drops tools — Codex adapter ignores params.tools, MCP tools invisible to Codex agents"
status: needs_merge
priority: 0
rank: 3
estimate: 3
summary: "LlmService.completionStream has tools as optional param. CodexLlmAdapter ignores it entirely — 78 MCP tools resolved by InProcProvider are silently dropped. Model responds with 'no tools available' despite tools being in the request. Any future LlmService adapter can silently drop tools with no compile-time or runtime error."
outcome: "LlmService adapters that receive tools must either use them or fail explicitly. Codex adapter connects to MCP servers via config.toml (Codex-native MCP support). No silent tool drop across any adapter."
spec_refs: [spec.tool-use]
assignees: []
credit:
project: proj.agentic-interop
branch: fix/bug-0232-codex-mcp-tools
pr: https://github.com/Cogni-DAO/node-template/pull/660
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-31
labels: [ai-graphs, tooling, mcp, byo-ai]
external_refs:
  - https://developers.openai.com/codex/mcp
  - https://developers.openai.com/codex/config-reference
---

# LlmService port silently drops tools

## Observed

**Symptom:** User selects Frontend Tester agent with Codex model. InProcProvider resolves 78 MCP tools (`mcpToolCount: 78`). Model responds: "This workspace only exposes filesystem/code/tools for file reads/commands; no active Grafana MCP/Playwright runtime."

**Root cause 1 — Port allows silent drop:**

`LlmService.completionStream` (`ports/llm.port.ts:135-145`) declares `tools?: readonly LlmToolDefinition[]` as optional. `CodexLlmAdapter` (`codex-llm.adapter.ts`) implements `LlmService` without ever reading `params.tools`. TypeScript is satisfied — optional fields can be ignored. Zero compile-time or runtime error.

```typescript
// ports/llm.port.ts:135
export interface CompletionStreamParams {
  messages: Message[];
  tools?: readonly LlmToolDefinition[];  // ← optional, can be silently ignored
}

// codex-llm.adapter.ts:64 — only reads messages and model
async completionStream(params: CompletionStreamParams) {
  // params.tools is NEVER referenced anywhere in this file
  const prompt = formatMessagesAsPrompt(params.messages);
  // ...
}
```

**Root cause 2 — Codex adapter doesn't use Codex's native MCP support:**

Codex SDK natively supports MCP servers via `$HOME/.codex/config.toml`:

```toml
[mcp_servers.grafana]
url = "http://grafana-mcp:8000/mcp"
bearer_token_env_var = "GRAFANA_SERVICE_ACCOUNT_TOKEN"
```

But our adapter overrides `HOME` to a temp dir (line 160: `envRecord.HOME = tempDir`) for auth isolation. The temp dir contains only `auth.json` — no `config.toml`. Codex sees zero MCP servers.

**Root cause 3 — Architecture mismatch:**

LangGraph's ReAct agent expects: LLM receives `tools[]` → returns `tool_calls` → agent executes → loop.

Codex SDK expects: MCP servers configured at startup → Codex's own agent loop orchestrates tool calls internally.

These are fundamentally different tool execution models. Passing OpenAI `tools[]` to Codex doesn't work — Codex is an agent, not a chat completion endpoint. But Codex CAN use the same MCP servers directly if configured.

## Expected

1. If an `LlmService` adapter receives `params.tools` and cannot use them, it MUST fail explicitly — not silently return text without tool calls.
2. Codex agents have access to MCP tools via Codex's native MCP support (config.toml).
3. The tool availability contract is enforced at the port level, not left to adapter discretion.

## Impact

- **All Codex users:** MCP tools (browser, grafana, any future MCP server) are invisible. The agent describes what it would do instead of doing it.
- **Future adapters:** Any new `LlmService` implementation can silently drop tools with no warning.
- **Cost:** Codex consumed 259K prompt tokens processing 78 tool definitions it could never use (tool schemas in the LangGraph system prompt).

## Design

### Outcome

Codex agents use MCP tools (Playwright, Grafana) via Codex's native MCP support. No silent tool drop across any LlmService adapter — enforcement happens at the port boundary, before the LLM call.

### Key Finding

`CodexModelProvider` already declares `capabilities.tools: false` (`codex.provider.ts:62`). The data exists — nothing enforces it. The fix is enforcement, not new capability declarations.

### Approach

**Solution:** Three changes — enforcement gate + Codex MCP config injection at adapter boundary + env var scoping.

**Reuses:**

- `ModelOption.capabilities.tools` (already declared per provider — `codex.provider.ts:62`)
- `parseMcpConfigFromEnv()` (already has the raw server URLs/config)
- Codex SDK `config.toml` native format with `enabled_tools`/`disabled_tools`
- Catalog `mcpServerIds` (controls which MCP servers a graph sees — policy stays here)

**Rejected:**

1. **`mcpEndpoints` on `CompletionStreamParams`** — pollutes shared port type for one adapter. Threads MCP config through 4 layers that don't use it. Inject at adapter boundary via `createLlmService()` instead.
2. **Making Codex participate in LangGraph's ReAct loop** — Codex is an agent with its own tool execution loop. Forcing `tools[] → tool_calls` fights the SDK design.
3. **Pretending this is "same path all executors"** — it is NOT. Codex MCP bypasses `toolRunner.exec()`. This is an explicit `INVARIANT_DEVIATION: TOOLS_VIA_TOOLRUNNER`, documented with mitigations.

### Architecture

```
InProcProvider.runGraph()
  │
  ├── resolves mcpServerIds → MCP server config (catalog + parseMcpConfigFromEnv)
  │
  ├── for LiteLLM/OpenAI-compatible (capabilities.tools: true):
  │   │ tools[] → LLM → tool_calls → toolRunner.exec() → LangGraph ReAct loop
  │   │ Full pipeline: policy → validate → exec → redact → emit events
  │   └── (existing path, unchanged)
  │
  └── for Codex (capabilities.tools: false):
      │ tools[] STRIPPED from LLM call (log WARN, don't waste tokens)
      │ MCP config injected at adapter boundary (not through params chain)
      │
      │ INVARIANT_DEVIATION: TOOLS_VIA_TOOLRUNNER
      │ Codex's internal agent loop calls MCP tools directly.
      │ No per-tool policy, no redaction, no tool telemetry.
      │ Mitigated by: server-level scoping (mcpServerIds) +
      │   Codex enabled_tools (tool-level allowlist) +
      │   $0 billing (user-funded) +
      │   output stays in agent loop (user sees final text only)
      │
      ├── CodexModelProvider.createLlmService(connection, mcpConfig)
      │   └── CodexLlmAdapter receives mcpConfig at construction
      │       └── writes config.toml to temp HOME alongside auth.json
      └── Codex SDK reads config.toml → connects to MCP servers → agent loop
```

**Critical constraints:**

- Codex only sees MCP servers declared in the graph's `mcpServerIds`
- Config.toml uses `enabled_tools` to preserve tool-level policy from graph allowlist
- Codex subprocess receives only whitelisted env vars, not full `process.env`

### Injection Point: Provider Boundary

MCP config injected where the adapter is constructed — `CodexModelProvider.createLlmService()` — not threaded through `CompletionStreamParams`:

```typescript
// codex.provider.ts
createLlmService(
  connection?: ResolvedConnection,
  mcpConfig?: CodexMcpConfig
): LlmService {
  return new CodexLlmAdapter(connection, mcpConfig);
}

interface CodexMcpConfig {
  servers: Record<string, {
    url: string;
    bearerTokenEnvVar?: string;   // env var NAME, not value
    enabledTools?: string[];      // tool-level allowlist
    disabledTools?: string[];     // tool-level denylist
  }>;
}
```

### Env Var Scoping

Current (`codex-llm.adapter.ts:156-160`): copies ALL `process.env` to Codex subprocess. Leaks `DATABASE_URL`, `LITELLM_MASTER_KEY`, `AUTH_SECRET`.

Fix: whitelist only what Codex needs — `HOME`, `PATH`, `NODE_ENV`, `TERM`, plus specific vars referenced in `config.toml` `bearer_token_env_var` fields.

### Enforcement Gate

**Where:** `InProcCompletionUnitAdapter.executeCompletionUnit()` — before `completionStream()`.

**Logic:** If `tools.length > 0` and `capabilities.tools === false`, log explicit WARN with `INVARIANT_DEVIATION` prefix, strip tools from LLM request.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] MCP_POLICY_SINGLE_SOURCE: Codex config.toml generated from graph's `mcpServerIds` + tool allowlist, not global config
- [ ] NO_SECRETS_IN_CONTEXT: MCP config injected at adapter construction, not through CompletionStreamParams. Auth via `bearer_token_env_var` names, values via scoped env whitelist
- [ ] CODEX_ENV_SCOPED: Codex subprocess receives only whitelisted env vars
- [ ] NO_SILENT_DROP: Tools present + `capabilities.tools=false` → WARN log with INVARIANT_DEVIATION prefix
- [ ] INVARIANT_DEVIATION_DOCUMENTED: TOOLS_VIA_TOOLRUNNER bypass documented in adapter with rationale
- [ ] CODEX_TOOL_POLICY: `enabled_tools`/`disabled_tools` in config.toml preserves tool-level allowlist

### Files

**Modify:**

- `apps/operator/src/adapters/server/ai/providers/codex.provider.ts` — `createLlmService()` accepts optional `CodexMcpConfig`
- `apps/operator/src/adapters/server/ai/codex/codex-llm.adapter.ts` — accept `CodexMcpConfig`, write `config.toml`, whitelist env vars
- `apps/operator/src/adapters/server/ai/langgraph/inproc.provider.ts` — resolve MCP config for Codex path, pass to `createLlmService()`
- `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — enforcement gate

**Do NOT modify:**

- `apps/operator/src/ports/llm.port.ts` — `CompletionStreamParams` stays clean
- `apps/operator/src/features/ai/services/completion.ts` — no MCP awareness needed

**Create:**

- `apps/operator/src/adapters/server/ai/codex/codex-mcp-config.ts` — `CodexMcpConfig` type + `generateConfigToml()`

**Test:**

- Unit: `codex-mcp-config.test.ts` — config.toml generation, env whitelist, tool scoping
- Unit: enforcement gate — tools stripped when `capabilities.tools=false`, WARN logged
- Integration: Codex agent with MCP → tools available via Codex native MCP

## Validation

**Command:**

```bash
# 1. Select Frontend Tester agent with Codex model
# 2. Ask: "access grafana preview logs"
# 3. Agent queries Grafana via Codex-native MCP (config.toml)
# 4. NOT: "This workspace only exposes filesystem/code/tools"
```

**Expected:** Codex agent queries Grafana via MCP and returns actual log data.

## Review Checklist

- [ ] **Work Item:** `bug.0232` linked in PR body
- [ ] **Spec:** TOOL_SAME_PATH_ALL_EXECUTORS (tool-use.md #25)
- [ ] **Spec:** MCP_POLICY_SINGLE_SOURCE — config.toml scoped to graph's mcpServerIds
- [ ] **Tests:** config.toml generation + enforcement gate + Codex MCP integration
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Discovered during: task.0228 (MCP client MVP)
- Related: bug.0231 (token usage triple attestation — Codex also has billing gap)
- Codex MCP docs: https://developers.openai.com/codex/mcp
- Codex config reference: https://developers.openai.com/codex/config-reference

## Review Feedback (revision 1)

### Blocking

1. **TOML injection in `generateConfigToml`** — server names and URLs interpolated into TOML without validation/escaping. Validate server name matches `/^[a-zA-Z0-9_-]+$/`, reject or escape URLs containing `"`. Add tests for special characters.

2. **Per-graph MCP scoping missing** — design says `mcpServerIds` filters which servers Codex sees, but implementation passes ALL servers at container construction. Either:
   - (a) Filter at adapter construction time (requires threading `mcpServerIds` from catalog), or
   - (b) Explicitly document as `KNOWN_DEVIATION: ALL_SERVERS_VISIBLE` in the adapter with rationale (Codex is user-funded, system prompt guides usage, only 2 servers exist). Update the invariant checklist to reflect reality.

### Non-blocking

- Remove printf-style `%d` from WARN log message (Pino structured fields carry the data)
- Fix barrel import: `container.ts` imports directly from `codex-mcp-config.ts` instead of barrel
- Add WARN log in `mcpServersToCodexConfig` when `server.headers` is non-empty (silent data loss)
- Add test: `buildScopedEnv` with `bearerTokenEnvVar` referencing a var not in env

## Attribution

- Investigation: traced from user report through InProcProvider → CodexLlmAdapter → discovered params.tools never read
