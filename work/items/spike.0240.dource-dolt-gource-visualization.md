---
id: spike.0240
type: spike
title: "Dource — Gource-style visualization for Dolt database history"
status: needs_design
priority: 0
rank: 1
estimate: 2
summary: "Integrate Dource (Gource for Dolt) into the Cogni frontend to visualize cogni-dao-memory commit history as an animated, interactive visualization. Tables as nodes, rows as leaves, committers as avatars."
outcome: "Interactive Dource visualization embedded in the Cogni dashboard showing real-time cogni-dao-memory history. Users can see who changed which tables/rows over time. Decision: embed via WebGL/Three.js, iframe Gource stream, or custom D3 reimplementation."
spec_refs: []
assignees: [derekg1729]
credit: []
project: proj.premium-frontend-ux
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [ui, ux, visualization, dolt, data-history, frontend]
external_refs:
  - https://github.com/acaudwell/Gource
  - https://www.dolthub.com/repositories/cogni/cogni-dao-memory
---

# Dource — Gource-style Visualization for Dolt Database History

## Context

Gource produces stunning animated visualizations of version control history — files as nodes in an expanding tree, contributors as avatars that orbit and interact with the nodes they change. Dolt (version-controlled SQL database) has an equivalent commit/diff model but no visual history tool.

**Dource** is a working CLI prototype (`/Users/derek/dev/dource`) that bridges this gap: it queries `dolt_log` and `dolt_diff_*` system tables, maps changes to Gource's custom log format (`timestamp|user|A/M/D|path|colour`), and pipes the result to Gource for rendering.

Validated against `cogni/cogni-dao-memory` — 357 commits, 9 tables, 622 change events. Video renders confirmed working.

## Research Questions

1. **Rendering approach:** Embed Gource via pre-rendered video, stream PPM frames via WebSocket, or reimplement the visualization in Three.js/D3?
2. **Real-time capability:** Can we stream new Dolt commits into a live visualization as they happen?
3. **Cogni-specific enhancements:** The current cogni-dao-memory video is dominated by `memory_blocks` and `block_links` — how do we make the visualization semantically richer? (e.g., colour by block type, cluster by namespace, size nodes by row count)
4. **Integration point:** Standalone `/dource` route? Widget on the dashboard? Part of the Three.js observatory (spike.0239)?
5. **Performance:** What's the rendering budget for 10K+ entries in-browser?

## Scope

- Spike only — evaluate approaches, build one working prototype
- Must connect to a live or recent cogni-dao-memory dataset
- At minimum: pre-rendered MP4 embedded in a dashboard component
- Stretch: interactive WebGL visualization with zoom/filter/time-scrub

## Requirements

- Visualize cogni-dao-memory commit history with table/row granularity
- Colour-code by table, show committer identity
- Playback controls (play/pause/speed/scrub)
- Identify semantic improvements specific to Cogni's schema (block types, namespaces)

## Allowed Changes

- `/Users/derek/dev/dource` — CLI tool (already exists)
- `src/app/(dashboard)/dource/` — new route (if web integration path chosen)
- `src/components/visualization/` — new visualization components

## Plan

- [ ] Evaluate rendering approaches (pre-rendered video vs WebGL vs D3)
- [ ] Prototype chosen approach with cogni-dao-memory data
- [ ] Add Cogni-specific semantic enhancements (block type colouring, namespace clustering)
- [ ] Performance test with full history
- [ ] Document decision and next steps

## Validation

```bash
# CLI tool (already working)
cd /Users/derek/dev/dource && source .venv/bin/activate
dource /path/to/cogni-dao-memory --rows --dry-run | head -20
```

**Expected:** Gource-format log lines with correct timestamps, users, and table paths.
