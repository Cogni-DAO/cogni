---
id: spike.0230
type: spike
title: "AI Browser Automation Tools — OSS Survey & Integration Path"
status: done
priority: 1
rank: 1
estimate: 2
summary: Research spike surveying OSS AI browser automation tools (Playwright MCP, Steel.dev, browser-use, Stagehand, Browserbase) for authenticated multi-tenant agents. Analyzes OpenClaw patterns and maps integration to existing LangGraph MCP infrastructure.
outcome: Research document with clear recommendation — Playwright MCP (immediate) + Steel.dev (multi-session) + credential broker (multi-tenant). No new project needed; fits within task.0228 and proj.agentic-interop.
spec_refs:
assignees: derekg1729
credit:
project: proj.agentic-interop
branch: feat/mcp-client-mvp
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-29
updated: 2026-03-29
labels: [browser, mcp, playwright, multi-tenant, agents, research]
external_refs:
  - docs/research/ai-browser-automation-tools.md
---

# AI Browser Automation Tools — OSS Survey & Integration Path

Parent: `proj.agentic-interop` | Related: `task.0228`

## Research Questions

1. What are the best OSS tools for AI browser automation?
2. How does OpenClaw handle browser access for AI agents? (reference architecture)
3. How do we integrate browser tools into our LangGraph agents via MCP?
4. How do we handle authenticated sessions in a multi-tenant environment?

## Findings

See: `docs/research/ai-browser-automation-tools.md`

### Summary

- **Primary choice**: Playwright MCP (`@playwright/mcp`) — already integrated via McpToolSource, just needs a running server
- **Session isolation**: Steel.dev — self-hosted Docker browser sandbox with CDP endpoints
- **Multi-tenant auth**: Credential broker pattern aligned with existing tenant-connections spec
- **Not viable**: browser-use (Python), Puppeteer MCP (superseded)
- **OpenClaw reference**: Most sophisticated OSS browser-for-AI system; three-scope isolation model (session/agent/shared)

### Recommendation

Three-phase progression, each incremental:

1. **Now**: Playwright MCP stdio → browser graphs work immediately
2. **Next**: Steel.dev Docker → isolated sessions per execution
3. **Future**: Credential broker → tenant-scoped authenticated sessions

## Validation

- [x] Research document written with tool comparisons and integration paths
- [x] OpenClaw architecture analyzed
- [x] Recommendation includes trade-offs and phased approach
- [x] Fits within existing project structure (no new project needed)
