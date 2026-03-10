# features/ai/config · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derek @core-dev
- **Last reviewed:** 2025-12-03
- **Status:** stable
- **Parent:** [features/ai](../AGENTS.md)

## Purpose

Configuration and static data for AI feature including provider icon registry for model selection UI.

## Pointers

- [Parent: AI Feature](../AGENTS.md)
- **Related:** [../components/](../components/) (ModelPicker)

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["core", "ports", "shared", "types", "components", "contracts"],
  "must_not_import": ["app", "adapters"]
}
```

## Public Surface

- **Exports (via ../public.ts):** none (internal to feature)
- **Routes:** none
- **Env/Config keys:** none
- **Files considered API:** provider-icons.ts (internal only)

## Responsibilities

- **This directory does:** Provide static configuration data (icon mappings, provider metadata)
- **This directory does not:** Implement UI components, manage state, or make API calls

## Usage

```typescript
// Used internally by ModelPicker component
import { getProviderIcon } from "../config/provider-icons";

const Icon = getProviderIcon(modelId); // Returns Lucide icon component
```

## Standards

- Pure data/config only (no side effects)
- Use only bundled assets (Lucide icons)
- Icon mappings inferred from model ID prefixes
- Internal to feature (not exported via public.ts)

## Dependencies

- **Internal:** none
- **External:** lucide-react

## Change Protocol

- No public API changes (internal directory)
- Add new provider mappings as models expand
- Keep icons limited to Lucide (no external icon deps)

## Notes

- Icons matched by model ID prefix (e.g., "gpt-4o" → "gpt" → Sparkles icon)
- Fallback to default icon (Zap) for unknown providers
- Currently supports: qwen, hermes, gpt, claude
