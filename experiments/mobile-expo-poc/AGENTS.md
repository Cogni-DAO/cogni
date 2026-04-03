# experiments/mobile-expo-poc · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Proof-of-concept Expo (React Native) mobile app. Validated on physical iPhone via Expo Go (2026-04-02). Reference for `apps/mobile/` scaffold when task.0265 is implemented.

## Pointers

- [proj.mobile-app](../../work/projects/proj.mobile-app.md): Project roadmap
- [Research: mobile strategy](../../docs/research/mobile-app-strategy.md): Options analysis + validated findings

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["packages"],
  "must_not_import": ["adapters", "core", "ports", "features", "app"]
}
```

## Public Surface

- **Exports:** none (experiment, not deployed)
- **Routes (if any):** none
- **CLI (if any):** `cd experiments/mobile-expo-poc && npx expo start`
- **Env/Config keys:** none
- **Files considered API:** none

## Responsibilities

- This directory **does**: Serve as a reference POC for mobile app architecture
- This directory **does not**: Run in production, get deployed, or participate in CI

## Notes

- Expo SDK 54, React 19.1, RN 0.81, NativeWind v4
- Validated: Metro + pnpm workspaces, Expo Router groups, NativeWind Tailwind classes
- NOT production code — placeholder screens with no real auth or API integration
