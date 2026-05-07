---
id: guide.assistant-ui-tool-rendering
type: guide
title: Customizing Tool-Call Rendering with assistant-ui
status: draft
trust: draft
summary: How to add a per-tool renderer to a node's chat UI using assistant-ui's makeAssistantToolUI, the shared ToolCard primitive, and the per-node ToolUIRegistry.
read_when: Adding or customizing how a tool call is displayed in /chat for any Cogni node
implements: []
owner: cogni-dev
created: 2026-05-06
verified: 2026-05-06
tags:
  - frontend
  - chat
  - assistant-ui
---

# Customizing Tool-Call Rendering with assistant-ui

## What this gives you

The default fallback already humanizes tool names (`core__knowledge_read` → `knowledge read`) and inlines a 3-arg summary chip. If that's enough for your tool, **do nothing** — it works for free the moment your tool is registered.

You only need a dedicated renderer when the tool's args/result carry meaningful identifiers (PR numbers, wallets, file paths, URLs) that the user should be able to **click**, or when you want a verb-first 1-liner that reads like product copy ("Flighted PR #1234 to candidate-a") instead of a key=value dump.

The operator's `core__vcs_flight_candidate` UI is the reference example. Open it in
`nodes/operator/app/src/components/vendor/assistant-ui/tool-ui-vcs-flight-candidate.tsx`.

## Mental model

1. The model emits a tool call. assistant-ui streams it as a `ToolCallMessagePart` — `{ toolName, args, argsText, result, status }`.
2. assistant-ui asks: "is there a registered renderer for this `toolName`?" If yes → use it. If no → fall back to the default `ToolFallback`.
3. **The model is unaware** of any of this. The narrative is 100% client-side. No prompt coupling, no extra tokens.
4. A renderer is just a React component that takes `ToolCallMessagePartProps<TArgs, TResult>` and returns JSX. We give it the typed args/result; it returns a `<ToolCard>`.

## The five-minute recipe

Add a renderer for a tool called `core__example_thing` to the **node-template** node.

### 1. Write the renderer

`nodes/node-template/app/src/components/vendor/assistant-ui/tool-ui-example-thing.tsx`

```tsx
"use client";

import {
  makeAssistantToolUI,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { SparklesIcon, Loader2Icon, AlertTriangleIcon } from "lucide-react";
import { ToolCard, ToolChip } from "@cogni/node-ui-kit/tool-card";

interface Args {
  readonly query?: string;
  readonly limit?: number;
}
interface Result {
  readonly count?: number;
  readonly url?: string;
}

const View: ToolCallMessagePartComponent<Args, Result> = ({
  args,
  result,
  status,
}) => {
  const isRunning = status?.type === "running";
  const hasError =
    status?.type === "incomplete" && status.reason !== "cancelled";

  const Icon = hasError ? AlertTriangleIcon : isRunning ? Loader2Icon : SparklesIcon;
  const tone = hasError ? "danger" : isRunning ? "info" : "success";

  const title = (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="font-medium">
        {isRunning ? "Searching" : hasError ? "Search failed" : "Searched"}
      </span>
      {args?.query && <ToolChip mono>{args.query}</ToolChip>}
      {result?.count != null && (
        <span className="text-muted-foreground">
          → {result.count} match{result.count === 1 ? "" : "es"}
        </span>
      )}
    </span>
  );

  const details = result?.url ? (
    <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">
      Open results →
    </a>
  ) : null;

  return (
    <ToolCard
      icon={Icon}
      iconClassName={isRunning ? "animate-spin" : undefined}
      tone={tone}
      title={title}
      details={details}
    />
  );
};

export const ExampleThingToolUI = makeAssistantToolUI<Args, Result>({
  toolName: "core__example_thing",
  render: View,
});
```

### 2. Mount it in the node's registry

`nodes/node-template/app/src/components/vendor/assistant-ui/tool-ui-registry.tsx`

```tsx
"use client";

import { ExampleThingToolUI } from "./tool-ui-example-thing";

export function ToolUIRegistry() {
  return (
    <>
      <ExampleThingToolUI />
      {/* add more per-tool UIs here */}
    </>
  );
}
```

`<ToolUIRegistry />` is already mounted inside the node's `Thread` (under
`AssistantRuntimeProvider`). Each per-tool component is a no-render `useAssistantToolUI`
side-effect — mounting *is* registration.

That's it. Reload `/chat`, trigger the tool, see the new card.

## What goes in `title` vs `details`

| Goes in `title` (the always-visible 1-liner) | Goes in `details` (collapsible body) |
|---|---|
| The verb (Searched / Flighted / Read / Wrote) | Full args / result JSON if you want to expose them |
| 1–3 chips for the most-clickable identifiers (PR #, wallet, sha) | A grid of all params for power users |
| A short outcome marker (`→ 12 matches`, `→ 200 OK`) | Error blocks (`bg-danger/10`) for `incomplete` status |
| Mono chips for code-shaped values (branches, hashes, paths) | External links to logs / dashboards / GitHub runs |

Keep the title to **one visual line at desktop width**. If you find yourself wanting more, that's body content.

## Status handling cheat sheet

`status.type` flows through three states. Branch icon and tone off it, not off `result`.

```ts
const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";
const hasError    = status?.type === "incomplete" && status.reason !== "cancelled";
const isRunning   = status?.type === "running" || status?.type === "requires-action";
// "complete" is the implicit success state
```

For the icon:
- success → tool's identity icon (`RocketIcon`, `SparklesIcon`, `BookOpenIcon`, etc.)
- running → `Loader2Icon` + `iconClassName="animate-spin"`
- error → `AlertTriangleIcon`, tone `danger`
- cancelled → `CircleSlashIcon`, tone `muted`

Auto-open the body on error (`<ToolCard defaultOpen={hasError} />`) so the user sees the message immediately.

## When **not** to write a custom renderer

- The tool's args are simple (`query`, `path`, `id`) and the default `key=value` summary is already readable.
- The result is purely textual and doesn't have URLs/identifiers worth linking.
- You're tempted to add a renderer for "just a few more visual points" — the default's bar is already solid; only customize when there's a clear win.

## When the model **does** need to participate

Almost never. Two cases:

1. The args alone don't tell the user *why* the tool was called (e.g. `core__vector_search` with `{ query, k: 12 }` — the user might want to know what topic). Solution: prompt the model to phrase the question, but use a *separate text part* before the tool call. Don't smuggle UI hints into args.
2. The result is structured but the *interesting* field for the human is computed (e.g. "found 12 matches but only 3 are high-confidence"). Solution: change the tool's output schema to include the summary field, then surface it in the renderer. The model still doesn't know about the UI.

If you find yourself wanting a `displayHint` arg on every tool, stop — you're rebuilding what the renderer should do client-side from typed args.

## Where the primitives live

- `@cogni/node-ui-kit/tool-card` — pure-presentation primitives: `ToolCard`, `ToolChip`, plus the `ToolCardTone` / `ToolCardProps` / `ToolChipProps` types. Zero coupling to `@assistant-ui/react`.
- `@cogni/node-ui-kit/tool-fallback` — the default `ToolFallback` renderer (assistant-ui-coupled). Each node's `Thread` imports it directly. To override per-node, write a local `ToolFallback` and pass it to `MessagePrimitive.Parts` in that node's `thread.tsx`.
- Per-node `tool-ui-registry.tsx` mounts every per-tool UI for that node.
- Per-node `tool-ui-*.tsx` files live under each node's `components/vendor/assistant-ui/`.
- The flight-candidate UI is operator-only because the tool itself is operator-scoped (`core__vcs_*`).

## Related

- `nodes/operator/app/src/components/vendor/assistant-ui/tool-ui-vcs-flight-candidate.tsx` — production reference renderer with linked PR / sha / candidate-a chips.
- `packages/ai-tools/src/tools/vcs-flight-candidate.ts` — the matching tool contract; renderer types its `Args`/`Result` from this.
- assistant-ui v0.12 docs: `makeAssistantToolUI`, `ToolCallMessagePartProps`, `ToolCallMessagePartStatus` (in `node_modules/@assistant-ui/react/dist/types/`).
