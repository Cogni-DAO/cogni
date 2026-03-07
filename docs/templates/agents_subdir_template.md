# [subdir-name] · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @handle1 @handle2 <!-- ≥1 required -->
- **Status:** stable | draft | deprecated

## Purpose

1–2 sentences: what this directory does in the system.

## Pointers

- [Key files/docs](../path): <!-- Insert most relevant key file(s) or documentation links here -->

## Boundaries

```json
{
  "layer": "...",
  "may_import": [],
  "must_not_import": []
}
```

## Public Surface

- **Exports:** modules/types that other dirs may rely on
- **Routes (if any):** `/api/feature` [GET, POST]
- **Env/Config keys:** `FEATURE_FLAG` | `none`

## Ports (optional)

- **Uses ports:** `AIService` | `none`
- **Implements ports:** `Telemetry` | `none`

## Responsibilities

- This directory **does**: …
- This directory **does not**: …

## Notes

- TODOs, caveats, "do not edit generated files," migrations

<!-- Optional sections — include only when non-empty:

## Usage
Minimal local commands (e.g. pnpm test -w path/to/this)

## Standards
Overrides to global coding/style rules (only if needed)

## Dependencies
- **Internal:** imports within repo (paths)
- **External:** NPM packages/services

## Change Protocol
Update this file when Exports, Routes, or Env/Config change.
-->
