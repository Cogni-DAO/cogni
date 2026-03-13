---
id: task.0162
type: task
title: Add voice-to-text input to chat composer
status: needs_design
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
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
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

- `apps/web/src/features/ai/chat/hooks/` — new `useSpeechToText.ts` hook
- `apps/web/src/components/kit/chat/` — new `ComposerVoiceInput.tsx` component
- `apps/web/src/components/kit/chat/index.ts` — export new component
- `apps/web/src/components/kit/chat/AGENTS.md` — document new component
- `apps/web/src/app/(app)/chat/page.tsx` — wire voice button into `composerLeft` slot
- `apps/web/src/features/ai/components/ChatComposerExtras.tsx` — add voice button alongside model/graph pickers
- `apps/web/package.json` / root `pnpm-lock.yaml` — add `@huggingface/transformers` dependency
- `tests/` — unit tests for the hook

## Plan

### Phase 1 — OSS engine selection

- [ ] **1.1** Evaluate `@huggingface/transformers` with `whisper-tiny` ONNX model for in-browser speech-to-text (runs via WebAssembly/WebGPU, truly local, ~40MB cached model download on first use)
- [ ] **1.2** If transformers.js proves too heavy for first pass, fall back to Web Speech API with a clear `TODO` noting the Chrome-sends-to-Google caveat and a plan to swap to local Whisper later
- [ ] **1.3** Decision: document chosen engine in this item before proceeding

### Phase 2 — Hook (`useSpeechToText`)

- [ ] **2.1** Create `apps/web/src/features/ai/chat/hooks/useSpeechToText.ts`
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

- [ ] **3.1** Create `apps/web/src/components/kit/chat/ComposerVoiceInput.tsx`
  - Follow exact pattern of `ComposerAddAttachment.tsx` (TooltipIconButton, same sizing `size-[34px]`)
  - Uses `Mic` icon from `lucide-react` (already a dependency)
  - Visual states: default (muted icon), recording (pulsing indicator or accent color)
  - `aria-label` toggles: "Start voice input" / "Stop voice input"
  - Returns `null` when `isSupported` is false (progressive enhancement)
  - Kit layer: no business logic, delegates to hook passed via props or composed at feature layer
- [ ] **3.2** Export from `apps/web/src/components/kit/chat/index.ts`
- [ ] **3.3** Add SPDX license header and TSDoc module documentation
- [ ] **3.4** Update `apps/web/src/components/kit/chat/AGENTS.md`

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

- [ ] **Work Item:** `task.0162` linked in PR body
- [ ] **Spec:** hexagonal architecture boundaries upheld (hook in features/, component in kit/)
- [ ] **Spec:** vendor `thread.tsx` not modified — uses `composerLeft` slot
- [ ] **Spec:** no proprietary cloud API for speech recognition (or caveat documented)
- [ ] **Tests:** new/updated tests cover the hook and component
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
