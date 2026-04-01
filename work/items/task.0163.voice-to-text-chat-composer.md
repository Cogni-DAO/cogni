---
id: task.0163
type: task
title: Add voice-to-text input to chat composer
status: done
priority: 1
rank: 99
estimate: 3
summary: Add a microphone button to the chat composer that transcribes speech to text using a 100% OSS, in-browser solution
outcome: Users can click a mic button in the chat composer, speak, and have their speech transcribed into the composer input — fully client-side with no proprietary cloud APIs
spec_refs:
assignees: claude
credit:
project:
branch: claude/add-voice-to-text-e35go
pr:
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-24
labels: [ai, ui]
external_refs:
---

# Add voice-to-text input to chat composer

## Requirements

- A microphone button appears in the chat composer action bar
- Clicking the button starts speech recognition; clicking again stops it
- Transcribed text is appended to existing composer content (does not overwrite)
- Solution must be 100% OSS — no audio sent to proprietary cloud services (rules out raw Web Speech API in Chrome, which proxies to Google servers)
- Button is hidden gracefully when the browser lacks support
- Accessible: proper `aria-label` toggling between "Start voice input" / "Stop voice input"
- Works without installing a backend service — runs entirely in-browser

## Allowed Changes

- `apps/operator/src/features/ai/chat/hooks/` — new `useSpeechToText.ts` hook
- `apps/operator/src/components/kit/chat/` — new `ComposerVoiceInput.tsx` component
- `apps/operator/src/components/kit/chat/index.ts` — export new component
- `apps/operator/src/components/kit/chat/AGENTS.md` — document new component
- `apps/operator/src/app/(app)/chat/page.tsx` — wire voice button into `composerLeft` slot
- `apps/operator/src/features/ai/components/ChatComposerExtras.tsx` — add voice button alongside model/graph pickers
- `apps/operator/package.json` / root `pnpm-lock.yaml` — add `@huggingface/transformers` dependency
- `tests/` — unit tests for the hook

## Design

### Outcome

Users can click a mic button in the chat composer, speak, and have their speech transcribed into the composer input — fully client-side with no new backend services.

### Approach

**Engine Decision: Web Speech API with documented caveat (Phase 1.2 fallback)**

The task's primary option (`@huggingface/transformers` + `whisper-tiny` ONNX) adds significant complexity for a first pass:

- ~40MB model download on first use (poor UX without a loading state / progress bar)
- Requires manual audio capture via `MediaRecorder` API, chunking, and processing pipeline
- WebGPU/WASM runtime has uneven browser support (Safari lacking)
- New dependency (`@huggingface/transformers`) adds bundle weight and maintenance burden

The Web Speech API provides the complete UX with **zero new dependencies**:

- Native browser API — Chrome, Edge, Safari, Firefox all support it (varying quality)
- Real-time interim results (streaming feel)
- The hook abstraction (`useSpeechToText`) cleanly encapsulates the engine, making the swap to local Whisper a single-file change later

**Caveat**: Chrome's `SpeechRecognition` proxies audio to Google servers. This is documented via a `TODO` in the hook with a plan to swap to `@huggingface/transformers` whisper-tiny in a follow-up task. Firefox uses on-device recognition (truly local).

**Solution**: Three new files, one modification, zero new dependencies.

1. **Hook** (`useSpeechToText.ts`) — Feature-layer hook wrapping `SpeechRecognition` API with state machine (`idle → listening → idle`). Uses `useComposerRuntime().setText()` from `@assistant-ui/react` for text injection. Snapshot-based append semantics prevent race conditions with user typing.

2. **Component** (`ComposerVoiceInput.tsx`) — Kit-layer presentational button. Follows `ComposerAddAttachment.tsx` pattern exactly: `TooltipIconButton`, `size-[34px]`, `Mic`/`MicOff` icons from `lucide-react`. Pure props: `isListening`, `isSupported`, `onToggle`. Returns `null` when unsupported.

3. **Integration** — `ChatComposerExtras.tsx` composes the hook + component alongside existing model/graph pickers. No changes to `Thread.tsx` or vendor code.

**Reuses**: `TooltipIconButton` (vendor), `lucide-react` icons (already installed), `@assistant-ui/react` composer runtime (already wired), `composerLeft` slot (already exists in `Thread.tsx`).

**Rejected alternatives**:

- **`@huggingface/transformers` whisper-tiny**: Too heavy for first pass — 40MB download, MediaRecorder plumbing, model loading UX, WebGPU browser gaps. Deferred to follow-up task.
- **Third-party React speech hooks** (e.g., `react-speech-recognition`): Wraps the same Web Speech API but adds a dependency for minimal benefit. Our hook is ~60 lines.
- **New kit component using `useComposerRuntime` directly**: Violates kit boundary (kit `must_not_import` features/ports). Hook stays at feature layer.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] KIT_BOUNDARY: `ComposerVoiceInput.tsx` in `components/kit/chat/` imports only from `shared`, `types`, vendor, and external deps — no features/ports/core
- [ ] FEATURE_HOOK: `useSpeechToText.ts` in `features/ai/chat/hooks/` — browser side-effects encapsulated here, not in kit
- [ ] VENDOR_PRISTINE: No modifications to `thread.tsx` or any vendor component
- [ ] APPEND_SEMANTICS: Transcribed text appends to existing content via snapshot (no overwrite)
- [ ] ACCESSIBLE: `aria-label` toggles between "Start voice input" / "Stop voice input"
- [ ] PROGRESSIVE_ENHANCEMENT: Button hidden when `SpeechRecognition` API unavailable
- [ ] NO_NEW_DEPS: Zero new npm dependencies (Web Speech API is native)
- [ ] SIMPLE_SOLUTION: Leverages existing patterns/OSS over bespoke code
- [ ] ARCHITECTURE_ALIGNMENT: Follows established patterns (spec: architecture)

### Files

<!-- High-level scope -->

- Create: `apps/operator/src/features/ai/chat/hooks/useSpeechToText.ts` — feature-layer hook wrapping SpeechRecognition with composer text injection
- Create: `apps/operator/src/components/kit/chat/ComposerVoiceInput.tsx` — presentational mic button (props-driven, no business logic)
- Modify: `apps/operator/src/components/kit/chat/index.ts` — export `ComposerVoiceInput`
- Modify: `apps/operator/src/features/ai/components/ChatComposerExtras.tsx` — compose hook + component alongside pickers
- Modify: `apps/operator/src/components/kit/chat/AGENTS.md` — document new component
- Modify: `apps/operator/src/features/ai/public.ts` — re-export hook if needed by tests
- Test: `tests/unit/features/ai/chat/hooks/useSpeechToText.test.ts` — hook state machine, append semantics, unsupported fallback, cleanup
- Test: `tests/unit/components/kit/chat/ComposerVoiceInput.test.tsx` — render/null when unsupported, aria-label toggle

## Plan

### Phase 1 — OSS engine selection

- [ ] **1.1** Evaluate `@huggingface/transformers` with `whisper-tiny` ONNX model for in-browser speech-to-text (runs via WebAssembly/WebGPU, truly local, ~40MB cached model download on first use)
- [ ] **1.2** If transformers.js proves too heavy for first pass, fall back to Web Speech API with a clear `TODO` noting the Chrome-sends-to-Google caveat and a plan to swap to local Whisper later
- [ ] **1.3** Decision: document chosen engine in this item before proceeding

### Phase 2 — Hook (`useSpeechToText`)

- [ ] **2.1** Create `apps/operator/src/features/ai/chat/hooks/useSpeechToText.ts`
  - Place in `features/ai/chat/hooks/` (not `components/kit/`) — this hook has browser side-effects (mic permissions, audio capture) and belongs at the feature layer
  - Returns `{ isListening, isSupported, transcript, start, stop, toggle, error }`
  - State machine: `idle → listening → processing → idle`
  - On `start`: snapshot current composer text
  - On interim result: set composer text = snapshot + interim (prevents race with user typing)
  - On final result: set composer text = snapshot + final, clear interim
  - Cleanup on unmount (stop recognition, release mic)
  - Handle permission denied error gracefully (surface via `error` field)
- [ ] **2.2** Add SPDX license header and TSDoc module documentation per style guide
- [ ] **2.3** Add `"use client"` directive (browser API access)

### Phase 3 — Component (`ComposerVoiceInput`)

- [ ] **3.1** Create `apps/operator/src/components/kit/chat/ComposerVoiceInput.tsx`
  - Follow exact pattern of `ComposerAddAttachment.tsx` (TooltipIconButton, same sizing `size-[34px]`)
  - Uses `Mic` icon from `lucide-react` (already a dependency)
  - Visual states: default (muted icon), recording (pulsing indicator or accent color)
  - `aria-label` toggles: "Start voice input" / "Stop voice input"
  - Returns `null` when `isSupported` is false (progressive enhancement)
  - Kit layer: no business logic, delegates to hook passed via props or composed at feature layer
- [ ] **3.2** Export from `apps/operator/src/components/kit/chat/index.ts`
- [ ] **3.3** Add SPDX license header and TSDoc module documentation
- [ ] **3.4** Update `apps/operator/src/components/kit/chat/AGENTS.md`

### Phase 4 — Integration

- [ ] **4.1** Wire `ComposerVoiceInput` into the existing `composerLeft` slot in `ChatComposerExtras.tsx` alongside model/graph pickers — do NOT modify vendor `thread.tsx`
- [ ] **4.2** Use `useComposerRuntime()` from `@assistant-ui/react` to call `setText()` for injecting transcribed text
- [ ] **4.3** Verify the overlay positioning works with the new button added to the extras bar

### Phase 5 — Tests

- [ ] **5.1** Unit test for `useSpeechToText` hook with mocked `SpeechRecognition` / transformers pipeline
  - Test: starts/stops recognition
  - Test: appends transcript to existing text (snapshot semantics)
  - Test: returns `isSupported: false` when API unavailable
  - Test: handles permission denied
  - Test: cleans up on unmount
- [ ] **5.2** Component render test for `ComposerVoiceInput`
  - Test: renders mic button when supported
  - Test: renders nothing when unsupported
  - Test: toggles aria-label on click

### Phase 6 — Validation

- [ ] **6.1** Run `pnpm check` — lint + type + format pass
- [ ] **6.2** Run `pnpm test` — all unit tests pass
- [ ] **6.3** Manual smoke test: open chat page, click mic, speak, verify text appears in composer

## Validation

**Command:**

```bash
pnpm check && pnpm test
```

**Expected:** All lint, type checks, and tests pass.

## Review Checklist

- [ ] **Work Item:** `task.0163` linked in PR body
- [ ] **Spec:** hexagonal architecture boundaries upheld (hook in features/, component in kit/)
- [ ] **Spec:** vendor `thread.tsx` not modified — uses `composerLeft` slot
- [ ] **Spec:** no proprietary cloud API for speech recognition (or caveat documented)
- [ ] **Tests:** new/updated tests cover the hook and component
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
