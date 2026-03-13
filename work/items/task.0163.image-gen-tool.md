---
id: task.0163
type: task
title: "Image generation tool + pipeline artifact support"
status: needs_implement
priority: 1
rank: 10
estimate: 5
summary: Add `core__image_generate` tool to the AI tool catalog with LiteLLM-routed image model capability, introduce ArtifactSinkPort for durable artifact storage, and extend the graph execution pipeline to surface artifact refs in GraphResult/GraphFinal
outcome: Any LangGraph graph can generate images via the `core__image_generate` tool; artifact refs surface through `GraphResult.artifacts` and `GraphFinal.artifacts` to callers; image bytes are written to ArtifactSinkPort (not carried in run payloads)
spec_refs:
assignees:
  - derekg1729
credit:
project: proj.tool-use-evolution
branch: feat/image-gen-tool
pr:
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-03-12
updated: 2026-03-13
labels: [ai-graphs, creative-ai, tooling]
external_refs:
---

# Image Generation Tool + Pipeline Artifact Support

## Context

Image generation models on OpenRouter (Gemini Flash Image, GPT-5 Image) work through the **chat completions API** — they're chat models that return images in `message.images[]`. OpenRouter does NOT have a dedicated `/images/generations` endpoint. Verified 2026-03-12.

Rather than building a dedicated image-gen graph (which would just be a system prompt wrapper), the right abstraction is a **tool** — `core__image_generate` — that any graph can call. The image model call is a reusable external capability with its own permissions, billing, observability, and provider churn concerns. The graph/LLM only decides _when_ to call it and prepares structured args. This follows the same pattern as `core__web_search` (calls Tavily HTTP API).

### LiteLLM routes image models (verified)

Our pinned LiteLLM image (commit cc238660, Dec 2025) **preserves `message.images[]`** from OpenRouter responses. The data flow:

1. OpenRouter returns `choices[0].message.images: [{ image_url: { url: "data:image/png;base64,..." }, type: "image_url" }]`
2. LiteLLM's `convert_dict_to_response.py` passes `images=choice["message"].get("images", None)` into its `Message` type
3. LiteLLM's `Message` type has `images: Optional[List[ImageURLListItem]]` where `ImageURLListItem = { image_url: { url: str }, index: int, type: "image_url" }`
4. Response is proxied to our app with images intact

Therefore the capability implementation calls **LiteLLM** (not OpenRouter directly), getting billing, logging, and observability for free.

### Pipeline gap — full output is lost after redaction

The current tool execution pipeline **does not preserve non-redacted output**:

1. `toolRunner.exec()` calls `boundTool.exec()` → gets full output (with `imageBase64`)
2. `toolRunner.exec()` calls `boundTool.redact()` → strips `imageBase64` per allowlist
3. Returns `{ ok: true, value: safeResult }` where `safeResult` = **redacted only** (`tool-runner.ts:372-376`)
4. LangChain tool func returns `JSON.stringify(result.value)` — **redacted** (`langchain-tools.ts:131`)
5. LangGraph stores this as `ToolMessage.content` — **no imageBase64**
6. `tool_call_result` AiEvent also carries only redacted output (`tool-runner.ts:346-352`)

The full base64 exists only as a transient local variable (`validatedOutput`) inside `toolRunner.exec()`. It is **never stored anywhere accessible** after that function returns. Scanning message state for `imageBase64` would find nothing.

### Solution: ArtifactSinkPort + onFullResult hook

Do NOT store image bytes in LangGraph message state (LangGraph checkpoints state — multi-MB base64 would bloat checkpoints and break durability). Do NOT carry raw bytes in `GraphResult`/`GraphFinal` (bloats run payloads, breaks once we move beyond in-proc execution).

Instead:

1. **`ArtifactSinkPort`** — a port interface for writing artifacts to durable storage. MVP implementation writes to local filesystem; future: S3/R2. Returns an `ArtifactRef` (type + ID + metadata).
2. **`onFullResult` async callback** on `ToolRunnerConfig` — thin transition hook that fires after `boundTool.exec()` with full (non-redacted) output, before redaction. Awaited with swallowed errors (sink failure must not break tool execution, but must be awaited to avoid race conditions). The callback writes to ArtifactSinkPort.
3. **`GraphResult.artifacts` / `GraphFinal.artifacts`** carry only `ArtifactRef[]` (lightweight refs), not raw bytes.

### Redaction still prevents token waste

```
Tool output:  { imageBase64: "iVBOR...(2MB)...", mimeType: "image/png", model: "...", prompt: "..." }
Allowlist:    ["mimeType", "model", "prompt"]
LLM sees:     { mimeType: "image/png", model: "gemini-2.5-flash-image", prompt: "..." }
ArtifactSink: receives full output via onFullResult → writes bytes → returns ArtifactRef
GraphResult:  artifacts: [{ type: "image", id: "art_xxx", mimeType: "image/png", ... }]
```

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Any graph (brain, research, future dreamscape, etc.)               │
│  → LLM decides to call core__image_generate tool                    │
│  → Tool generates image via ImageGenerateCapability                  │
│    → Capability calls LiteLLM proxy (not OpenRouter directly)       │
│    → LiteLLM routes to OpenRouter image model                       │
│    → LiteLLM preserves message.images[] in response                 │
│  → Tool returns base64 + metadata                                   │
│  → onFullResult hook fires with full output before redaction        │
│    → ArtifactSinkPort.write() stores bytes, returns ArtifactRef     │
│  → Redacted output (no base64) returned to LLM                     │
│  → GraphResult.artifacts carries ArtifactRef[] (not bytes)          │
│  → GraphFinal.artifacts carries refs to callers                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data flow through pipeline

```
1. LLM calls core__image_generate({ prompt, model?, size? })
2. Tool implementation:
   a. ImageGenerateCapability.generate() → calls LiteLLM chat completions
   b. LiteLLM proxies to OpenRouter image model
   c. Extracts base64 from response.choices[0].message.images[0].image_url.url
   d. Returns { imageBase64, mimeType, model, prompt }
3. Tool runner (tool-runner.ts):
   a. boundTool.exec() → full output (with imageBase64)
   b. await onFullResult(toolCallId, fullOutput) → ArtifactSinkPort.write() → ArtifactRef (try/catch, swallow errors)
   c. boundTool.redact() → strips imageBase64 per allowlist
   d. Returns redacted output to LangChain tool → LLM
4. LLM responds with text referencing the generated image
5. Runner (runner.ts):
   a. extractAssistantContent() → text response (unchanged)
   b. Collects ArtifactRef[] accumulated during run
   c. GraphResult.artifacts = collected refs
6. GraphExecutorPort pipeline:
   a. GraphFinal.artifacts carries ArtifactRef[] to caller
   b. Caller uses refs to retrieve bytes from ArtifactSinkPort
```

### Key decisions

1. **Tool, not graph** — The image model call is a reusable external capability with permissions, billing, observability, and provider churn. The graph/LLM only decides _when_ to call it and prepares structured args. Nodes are for deterministic transforms, routing, approval, prompt-building, and post-processing.

2. **Through LiteLLM, not direct OpenRouter** — Our pinned LiteLLM (Dec 2025, cc238660) preserves `message.images[]`. Routing through LiteLLM gives us billing tracking, logging, observability, and rate limiting for free. The capability implementation calls the LiteLLM proxy endpoint.

3. **Capability interface** — `ImageGenerateCapability` abstracts the LiteLLM call. Implementation injected at runtime. Follows `WebSearchCapability` pattern exactly.

4. **ArtifactSinkPort, not in-memory Map** — Image bytes must not live in run payloads or message state. `ArtifactSinkPort.write()` persists bytes to durable storage, returns an `ArtifactRef`. MVP: local filesystem sink. Future: S3/R2.

5. **Refs, not bytes in GraphResult/GraphFinal** — `artifacts: ArtifactRef[]` carries lightweight references (type, ID, mimeType, size). Callers retrieve bytes separately. This keeps run payloads small and works beyond in-proc execution.

6. **onFullResult as async transition hook** — Added to `ToolRunnerConfig` as an optional `onFullResult(toolCallId: string, fullOutput: unknown) => Promise<void>` callback. Fires after `boundTool.exec()`, before `boundTool.redact()`. **Must be async and awaited** — the sink is async (filesystem/S3), so a sync callback creates a race where refs aren't populated by the time `GraphResult` is built. Errors are swallowed (sink failure must not break tool execution). This is the minimal change to ai-core (additive, optional field).

7. **Redaction prevents token waste** — The LLM never sees the base64 payload. Only metadata (mimeType, model, prompt) is in the allowlist. Full image data flows through onFullResult to ArtifactSinkPort.

8. **Effect is `external_side_effect`** — The tool calls an external API (LiteLLM → OpenRouter) that generates new content. Per the `ToolEffect` type: `"read_only" | "state_change" | "external_side_effect"`.

9. **No image bytes in LangGraph state** — LangGraph's runtime is built around state/checkpoint semantics. Large runtime-only values should NOT be checkpointed. Image bytes go to ArtifactSinkPort, not message state.

### Available OpenRouter image models (verified 2026-03-12)

| Model ID                                | Notes                         |
| --------------------------------------- | ----------------------------- |
| `google/gemini-2.5-flash-image`         | Default — cheap, good quality |
| `google/gemini-3.1-flash-image-preview` | Newer                         |
| `google/gemini-3-pro-image-preview`     | Higher quality                |
| `openai/gpt-5-image-mini`               | OpenAI mini                   |
| `openai/gpt-5-image`                    | OpenAI flagship               |

## Requirements

- `core__image_generate` tool contract in `@cogni/ai-tools` with Zod input/output schemas
- `ImageGenerateCapability` interface in `@cogni/ai-tools/capabilities/`
- Tool registered in `TOOL_CATALOG`
- `ImageGenerateCapability` implementation calls LiteLLM proxy (not OpenRouter directly)
- `ArtifactSinkPort` interface in `packages/ai-core/` with `write()` → `ArtifactRef`
- `ArtifactRef` type: `{ type: "image"; id: string; mimeType: string; byteLength: number; toolCallId: string; metadata?: Record<string, unknown> }`
- `onFullResult` optional async callback on `ToolRunnerConfig` — fires with `(toolCallId, fullOutput)` after exec, before redact; awaited with swallowed errors
- MVP `LocalFsArtifactSink` implementation in `apps/web/src/adapters/`
- `GraphResult` and `GraphFinal` extended with optional `artifacts: ArtifactRef[]` field
- Runner collects `ArtifactRef[]` accumulated during run, populates `GraphResult.artifacts`
- `gemini-2.5-flash-image` model registered in LiteLLM config
- Capability wired in bootstrap (`tool-bindings.ts`)
- All tool invariants upheld: TOOL_ID_NAMESPACED, EFFECT_TYPED, REDACTION_REQUIRED, NO_LANGCHAIN_IMPORTS, AUTH_VIA_CAPABILITY_INTERFACE
- Exported from `@cogni/ai-tools` package index
- `pnpm check` and `pnpm packages:build` pass

## Allowed Changes

### `packages/ai-core/` — ArtifactSinkPort + onFullResult hook

- `src/tooling/types.ts` — add `ArtifactRef` type, add optional `onFullResult` to `ToolRunnerConfig`
- `src/tooling/tool-runner.ts` — call `onFullResult(toolCallId, validatedOutput)` after exec, before redact
- `src/tooling/ports/artifact-sink.port.ts` — new: `ArtifactSinkPort` interface with `write()` method
- `src/index.ts` — export new types and port

### `packages/ai-tools/` — Tool contract + capability

- `src/tools/image-generate.ts` — new: tool contract, schemas, stub, bound tool
- `src/capabilities/image-generate.ts` — new: `ImageGenerateCapability` interface
- `src/capabilities/index.ts` — export new capability
- `src/catalog.ts` — register `imageGenerateBoundTool`
- `src/index.ts` — export new tool + capability types

### `packages/langgraph-graphs/` — Pipeline artifact support

- `src/inproc/types.ts` — add `artifacts: ArtifactRef[]` to `GraphResult`
- `src/inproc/runner.ts` — accept optional artifacts array, populate `GraphResult.artifacts`

### `apps/web/` — Wiring + port extension + MVP sink

- `src/ports/graph-executor.port.ts` — add `artifacts: ArtifactRef[]` to `GraphFinal`
- `src/adapters/server/ai/langgraph/inproc.provider.ts` — pass `artifacts` through to `GraphFinal`, wire `onFullResult` hook to ArtifactSinkPort
- `src/adapters/server/ai/artifact-sink/local-fs.adapter.ts` — new: MVP `LocalFsArtifactSink` writes to `/tmp/cogni-artifacts/`
- `src/bootstrap/ai/tool-bindings.ts` — wire `ImageGenerateCapability` implementation

### `infra/` — Model config

- `infra/compose/runtime/configs/litellm.config.yaml` — add `gemini-2.5-flash-image`

## Plan

### Layer 1: ArtifactSinkPort + onFullResult hook (packages/ai-core)

- [ ] Define `ArtifactRef` type in `src/tooling/types.ts` — `{ type: string; id: string; mimeType: string; byteLength: number; toolCallId: string; metadata?: Record<string, unknown> }`
- [ ] Define `ArtifactSinkPort` interface in `src/tooling/ports/artifact-sink.port.ts` — `write(toolCallId: string, data: Buffer | string, metadata: { type: string; mimeType: string }) => Promise<ArtifactRef>`
- [ ] Add optional `onFullResult?: (toolCallId: string, fullOutput: unknown) => Promise<void>` to `ToolRunnerConfig`
- [ ] In `tool-runner.ts`, `await config.onFullResult(toolCallId, validatedOutput)` after step 6 (validate output), before step 7 (redact) — wrapped in try/catch, swallow errors (sink failure must not break tool execution, but must be awaited to avoid race conditions with artifact ref population)
- [ ] Export from `src/index.ts`

### Layer 2: Tool contract + capability (packages/ai-tools)

- [ ] Create `src/capabilities/image-generate.ts` — `ImageGenerateCapability` interface with `generate(params)` method
- [ ] Export from `src/capabilities/index.ts`
- [ ] Create `src/tools/image-generate.ts` — `IMAGE_GENERATE_NAME`, input/output schemas, contract, stub, bound tool
- [ ] Effect: `"external_side_effect"` (NOT `"uncontrolled"` — that value doesn't exist)
- [ ] Redaction: allowlist `["mimeType", "model", "prompt"]` — strips `imageBase64`
- [ ] Register in `src/catalog.ts` — add `imageGenerateBoundTool` to `TOOL_CATALOG`
- [ ] Export from `src/index.ts` — all public types and values

### Layer 3: Pipeline artifact support (packages/langgraph-graphs)

- [ ] Add `ArtifactRef` import from `@cogni/ai-core` in `src/inproc/types.ts`
- [ ] Add optional `artifacts?: readonly ArtifactRef[]` field to `GraphResult`
- [ ] In `runner.ts`, accept optional `artifacts` array in runner options; populate `GraphResult.artifacts` in success path
- [ ] Note: NO `onArtifact` callback on runner — the provider accumulates refs in a closure via `onFullResult` and passes the final array to the runner result. Keep runner simple.

### Layer 4: Port + adapter wiring + MVP sink (apps/web)

- [ ] Add `artifacts?: readonly ArtifactRef[]` field to `GraphFinal` in `src/ports/graph-executor.port.ts`
- [ ] Create `src/adapters/server/ai/artifact-sink/local-fs.adapter.ts` — MVP `LocalFsArtifactSink` writes files to `/tmp/cogni-artifacts/<runId>/<toolCallId>.<ext>`, returns `ArtifactRef`
- [ ] In `inproc.provider.ts`: wire async `onFullResult` callback that checks for `imageBase64` in full output, calls `artifactSink.write()`, accumulates `ArtifactRef[]` in a closure, and passes the collected array into runner result
- [ ] Pass `artifacts` through in `mapToGraphFinal` when constructing `GraphFinal`
- [ ] Wire `ImageGenerateCapability` implementation in `src/bootstrap/ai/tool-bindings.ts` — implementation calls LiteLLM proxy chat completions with image model, extracts base64 from `message.images[0].image_url.url`

### Layer 5: LiteLLM config

- [ ] Add `gemini-2.5-flash-image` model entry in `litellm.config.yaml` routed through OpenRouter

### Validation

- [ ] `pnpm check` passes (lint, types, format)
- [ ] `pnpm packages:build` succeeds
- [ ] Unit test: tool contract validates input/output schemas
- [ ] Unit test: `onFullResult` fires with full output before redaction
- [ ] Unit test: redaction strips `imageBase64` from LLM-facing output
- [ ] Unit test: `ArtifactSinkPort.write()` returns proper `ArtifactRef`
- [ ] Unit test: `GraphResult.artifacts` populated from collected refs

## Validation

**Command:**

```bash
pnpm check && pnpm packages:build
```

**Expected:** All lint, type-check, and build passes.

**Unit tests:**

```bash
pnpm test -- image-generate
pnpm test -- artifact-sink
```

**Expected:** Tool contract schemas validate, redaction strips base64, onFullResult fires, artifact sink writes and returns refs, runner collects refs into GraphResult.

## Out of scope (follow-up tasks)

- **PR dreamscape CLI** — `scripts/pr-dreamscape.sh` + `.claude/commands/git-review.md` that invokes a graph with `core__image_generate` in its tool allowlist. Separate task once this foundation ships.
- **UI image rendering** — Rendering `artifacts` in the chat UI. Separate task.
- **Image model selection** — Allow callers to override which image model the tool uses. Can be added to the tool input schema later.
- **Durable artifact storage** — Replace `LocalFsArtifactSink` with S3/R2. Separate task.
- **Artifact retrieval API** — REST endpoint to fetch artifact bytes by ref ID. Separate task.
- **Max artifact guards** — Per-run artifact count/size limits. Add when needed.

## Review Checklist

- [ ] **Work Item:** `task.0163` linked in PR body
- [ ] **Spec:** tool invariants upheld (TOOL_ID_NAMESPACED, EFFECT_TYPED, REDACTION_REQUIRED, AUTH_VIA_CAPABILITY_INTERFACE)
- [ ] **Spec:** pipeline invariants upheld (ASSISTANT_FINAL_REQUIRED, GRAPH_FINALIZATION_ONCE)
- [ ] **Spec:** no image bytes in LangGraph message state or GraphResult/GraphFinal payloads
- [ ] **Spec:** onFullResult hook is fire-and-forget, swallows errors
- [ ] **Tests:** unit tests for tool contract, redaction, onFullResult, artifact sink, ref collection
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Review Feedback

### Rev 3 — Implementation Review (2026-03-13)

**Verdict: REQUEST CHANGES**

**Blocking:**

1. **Missing `onFullResult` pipeline test** — Add test in `apps/web/tests/unit/shared/ai/tool-runner-pipeline.spec.ts`:
   - `onFullResult` called with `(toolCallId, validatedOutput)` after `validateOutput()`, before `redact()`
   - Errors in `onFullResult` are swallowed (tool exec still succeeds)
   - `onFullResult` is awaited (not fire-and-forget)

2. **Missing artifact sink behavior test** — Add a test covering the `onFullResult` → sink → ref collection flow. Can be in provider spec or new test file.

**Non-blocking suggestions:**

- Consider `Uint8Array` over `Buffer` in `ArtifactWriteParams.data` for cross-runtime compat
- Add `vi.clearAllMocks()` in `beforeEach` for `image-generate.test.ts`

## Attribution

-
