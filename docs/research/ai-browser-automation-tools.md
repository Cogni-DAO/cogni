---
id: ai-browser-automation-tools
type: research
status: active
trust: draft
title: "AI Browser Automation: OSS Tools, Auth Patterns, and LangGraph Integration"
summary: Survey of OSS browser-use tools for authenticated AI agents with multi-tenant connections. Evaluates Playwright MCP, Steel.dev, browser-use, Stagehand, and others. Analyzes OpenClaw patterns and maps integration path to our LangGraph MCP infrastructure.
read_when: Building browser-capable AI agents, designing multi-tenant browser sessions, or extending MCP tool catalog
owner: derekg1729
created: 2026-03-29
verified: 2026-03-29
tags: [browser, mcp, playwright, multi-tenant, agents, research]
---

# Research: AI Browser Automation for Authenticated LangGraph Agents

> spike: (extends task.0228 MCP Client MVP) | date: 2026-03-29

## Question

What are the best OSS tools for giving AI agents browser access — especially when those agents need authenticated sessions in a multi-tenant environment? How can we wire this into our LangGraph graphs via MCP, right now?

## Context

### What we have today

Our `feat/mcp-client-mvp` branch already has:

1. **MCP client infrastructure** (`packages/langgraph-graphs/src/runtime/mcp/`) — `loadMcpTools()`, `McpToolSource`, `mcpToolToBoundRuntime()`, env-based config parsing
2. **Two browser-ready graphs** in the catalog:
   - `browser` graph — general web browsing agent
   - `frontend-tester` graph — QA automation agent
3. Both declare `mcpServerIds: ["playwright"]` — they expect a Playwright MCP server
4. **No running Playwright MCP server** — the plumbing exists but the server isn't deployed yet
5. **Tool composition** works: native tools + MCP tools merge into a unified `StaticToolSource` per graph execution

### What prompted this research

The user wants to understand what's available in the OSS AI browser-use space, how OpenClaw handles browser automation (as a reference architecture), and what the fastest path is to browser-capable agents in our system.

---

## Findings

### Option A: Playwright MCP (`@playwright/mcp`) — Primary Choice

**What**: Official Microsoft MCP server exposing 25+ browser automation tools via accessibility-tree snapshots. No vision model required.

**Pros:**

- TypeScript, MCP-native — directly compatible with our `McpToolSource` pipeline
- Already prototyped: our graphs declare `mcpServerIds: ["playwright"]`, just need a running server
- 29.9k GitHub stars, daily active development
- Three auth modes: persistent user profiles (cookies/localStorage survive restarts), isolated contexts, CDP connect to existing browser
- 2026 features: incremental DOM snapshots (token savings), self-healing selectors (75%+ fix rate)
- Supports `--cdp-endpoint` for connecting to remote/cloud browsers (Steel, Browserbase)

**Cons:**

- No built-in multi-tenant session isolation — one Chrome user-data-dir per process
- Multi-session requires launching separate servers or using CDP to connect to isolated browser instances
- Auth state management is manual (persistent profile mode or cookie injection)

**OSS**: Apache-2.0

**Integration path**: Spawn as stdio subprocess via `MCP_CONFIG_PATH`:

```json
{
  "mcpServers": {
    "playwright": {
      "transport": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp", "--headless"]
    }
  }
}
```

**Fit**: Excellent for dev/single-tenant. For multi-tenant: pair with Steel.dev or Browserbase for session isolation.

---

### Option B: Steel.dev — Self-Hosted Browser Infrastructure

**What**: OSS headless browser API — Docker-deployable browser sandbox with anti-bot, session management, and proxy rotation.

**Pros:**

- Fully self-hostable (single Docker container: `ghcr.io/steel-dev/steel-browser`)
- Session-level isolation out of the box — each session gets its own browser context
- Cookie/localStorage persistence across sessions
- Built-in CAPTCHA solving, fingerprint management, proxy rotation
- Exposes CDP endpoints — Playwright MCP can connect via `--cdp-endpoint`
- 1-click Railway deploy, Docker Compose ready
- Reduces LLM token usage up to 80% via content extraction optimization
- 6.7k GitHub stars, active development

**Cons:**

- REST API, not MCP — need to either: (a) connect via CDP to Playwright MCP, or (b) write custom LangGraph tools
- Community `steel-browser-multi` fork for multi-session; official version manages sessions via REST API
- Self-hosting means we manage the container lifecycle

**OSS**: Yes (GitHub: `steel-dev/steel-browser`). Also has commercial Steel Cloud.

**Integration path**: Run Steel Docker container → create session via REST → get CDP endpoint → pass to Playwright MCP:

```json
{
  "mcpServers": {
    "playwright": {
      "transport": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp", "--cdp-endpoint", "ws://steel:9222"]
    }
  }
}
```

**Fit**: Best self-hosted option for multi-tenant production. Pairs naturally with Playwright MCP.

---

### Option C: Stagehand (by Browserbase)

**What**: TypeScript AI browser automation SDK with hybrid code+AI approach, auto-caching, and self-healing selectors.

**Pros:**

- TypeScript-native, v3 uses direct CDP (44% faster than Playwright overhead)
- Hybrid model: deterministic code steps + AI for ambiguous actions
- Auto-caching: remembers past actions, replays without LLM calls (token savings)
- MCP server mode via `stagehand-mcp`
- 21.7k GitHub stars

**Cons:**

- Designed for Browserbase cloud — self-hosted story is less mature
- Different mental model from Playwright MCP (library + cloud vs. MCP tools)
- Adds a layer of abstraction over what Playwright already does well

**OSS**: MIT. But cloud-first design.

**Fit**: Worth watching. Not the immediate path given our existing Playwright MCP integration.

---

### Option D: browser-use (Python)

**What**: Python library achieving 89.1% on WebVoyager benchmark — highest OSS score.

**Pros:**

- 84.9k GitHub stars (most popular in category)
- Best benchmark performance
- Event-driven architecture with watchdogs

**Cons:**

- Python — we're TypeScript/LangGraph.js. Would require Python sidecar.
- `browser-use-mcp` npm package wraps their cloud API (requires API key), not self-hosted
- Different ecosystem entirely

**Fit**: Not viable for our TypeScript stack without significant bridging.

---

### Option E: Browserbase (Cloud)

**What**: Cloud browser-as-a-service with isolated sessions, anti-bot, and session persistence. $40M Series B (2025).

**Pros:**

- True multi-tenant isolation (core design)
- Persistent contexts with state preservation
- Live debugging for real-time intervention
- Per-minute billing aligns cost with usage

**Cons:**

- Commercial ($20-99/mo + per-minute). Not self-hostable.
- Vendor lock-in for session management
- Adds external dependency

**Fit**: Fallback if Steel self-hosting proves too complex. Good for "just works" multi-tenant.

---

### Option F: Anthropic Puppeteer MCP (`@modelcontextprotocol/server-puppeteer`)

**What**: Anthropic's reference MCP server for Puppeteer. Navigation, screenshots, JS execution.

**Pros:**

- Part of official MCP servers repo (82.4k stars for monorepo)
- Simple, well-documented

**Cons:**

- Far less capable than Playwright MCP (basic tools only, no accessibility-tree snapshots)
- No session persistence, no multi-tenant
- Largely superseded by Playwright MCP

**Fit**: Not recommended. Playwright MCP is strictly better.

---

## OpenClaw Reference Architecture

OpenClaw has the most sophisticated OSS browser automation for AI agents I've found. Key patterns:

### Browser Access Model

- **Playwright-core** as the engine (not full Playwright test runner)
- **Three execution paths**: sandbox browser (Docker container), host browser (user's machine), node browser proxy (remote nodes)
- **Chrome MCP integration** for connecting to existing user browser sessions via CDP

### Multi-Tenant Isolation (SandboxScope)

- **Session scope**: each unique session key → own browser container
- **Agent scope**: all sessions of an agent ID share one container
- **Shared scope**: single container for all agents (trusted only)
- Docker network isolation, read-only filesystem, capability dropping, resource limits

### Auth Pattern (Bridge Auth Registry)

- Per-sandbox ephemeral token (`crypto.randomBytes(24).toString("hex")`)
- In-memory auth registry mapping port → credentials
- HTTP bearer token in `Authorization` header
- Loopback-only binding (127.0.0.1) — no external access

### Key Insight: Session-to-Container Mapping

```
agentSessionKey → resolveSandboxScopeKey(scope, sessionKey)
  → slugifySessionKey() → container name
  → BROWSER_BRIDGES Map<scopeKey, {bridge, containerName, authToken}>
```

This is the pattern we'd need for multi-tenant browser sessions — each tenant/session gets an isolated browser with unique auth credentials.

---

## Multi-Tenant Authenticated Browsing Patterns (2026 State of Art)

### Pattern A: Cookie/Session Injection (Simplest)

- Capture cookies from logged-in session → inject into agent's browser context via `context.addCookies()`
- Used by: Playwright MCP persistent profiles, Steel sessions, Browserbase contexts
- Risk: cookie expiry, session rotation

### Pattern B: OAuth Token Exchange (RFC 8693) (Most Secure)

- User grants OAuth consent once → system obtains refresh token → agent gets short-lived, scope-narrowed token per task
- Recommended 2026 pattern for API-level auth delegation (NIST guidance Feb 2026)
- Our existing tenant-connections spec already models this

### Pattern C: CDP Connect to User's Browser (Dev Only)

- Playwright MCP Chrome Extension mode — connect to running user browser
- Great for dev/personal use. Not viable for multi-tenant production.

### Pattern D: Cloud Browser + Credential Broker (Production Multi-Tenant)

- Steel/Browserbase provide isolated cloud sessions
- Credential broker injects per-tenant auth at session creation
- Sessions fully isolated — Tenant A's cookies never leak to Tenant B
- Aligns with our existing `ConnectionBrokerPort` / `CredentialFaucetPort` architecture (see `docs/spec/tenant-connections.md`)

---

## Recommendation

### Right Now (this branch, task.0228)

**Playwright MCP via stdio** — zero new infrastructure:

1. Add `@playwright/mcp` to devDependencies
2. Configure in `mcp.servers.json` (already supported by `parseMcpConfigFromEnv`)
3. The `browser` and `frontend-tester` graphs already work — they declare `mcpServerIds: ["playwright"]`
4. Use `--headless` for CI, persistent profile for dev auth

This gets us browser-capable agents **today** with the plumbing that already exists.

### Next Step (multi-session)

**Steel.dev Docker container** for session isolation:

1. Add `steel-browser` to `infra/compose/` (it's a single Docker image)
2. Create sessions via Steel REST API → get CDP endpoints
3. Pass CDP endpoint to Playwright MCP via `--cdp-endpoint`
4. Each graph execution gets its own isolated browser session

### Future (multi-tenant production)

**Credential broker pattern** aligned with tenant-connections:

1. `ConnectionBrokerPort` resolves browser credentials per tenant
2. Steel session created with tenant-specific cookie injection
3. Graph execution receives pre-authed CDP endpoint
4. Session cleanup on graph completion

This progression (stdio → Steel → credential broker) is incremental — each step builds on the previous without rework.

---

## Open Questions

1. **Token budget**: Playwright MCP accessibility-tree snapshots can be large. How many tokens per page? Is incremental snapshot mode (2026 feature) stable enough?
2. **Steel.dev reliability**: How battle-tested is the self-hosted Docker image? Any gotchas with CDP endpoint stability?
3. **Session lifecycle**: Who owns browser session cleanup? The graph? The graph-executor? A separate lifecycle manager?
4. **Anti-bot**: For public web browsing, do we need Steel's fingerprint/proxy features or is raw Chromium sufficient?
5. **Cost model**: Persistent browser containers consume RAM. What's the cost per idle session? Should we use ephemeral sessions only?

---

## Comparison Matrix

| Tool               | Stars | OSS | MCP         | Self-Host    | Auth Sessions   | Multi-Tenant    | Best For                            |
| ------------------ | ----- | --- | ----------- | ------------ | --------------- | --------------- | ----------------------------------- |
| **Playwright MCP** | 29.9k | Yes | Native      | Yes          | Profiles, CDP   | Manual          | Primary choice — already integrated |
| **Steel.dev**      | 6.7k  | Yes | Via CDP     | Yes (Docker) | Cookie persist  | Yes             | Session isolation layer             |
| **Stagehand**      | 21.7k | Yes | Via wrapper | Partial      | Via Browserbase | Via Browserbase | Hybrid code+AI (future)             |
| **browser-use**    | 84.9k | Yes | Cloud only  | Python only  | Cookies         | Manual          | Python shops only                   |
| **Browserbase**    | N/A   | No  | Via CDP     | No           | Full persist    | Yes             | Managed fallback                    |
| **Puppeteer MCP**  | N/A   | Yes | Native      | Yes          | Basic           | No              | Superseded by Playwright            |

---

## Proposed Layout

### No New Project Needed

This fits within the existing `proj.agentic-interop` project and `task.0228` (MCP Client MVP).

### Specs to Update

- **`docs/spec/tool-use.md`** — add MCP browser tool policies, allowlisting rules
- **`docs/spec/tenant-connections.md`** — add browser session as a connection type when multi-tenant lands

### Tasks (PR-sized, rough sequence)

1. **task.0228 (existing)**: MCP Client MVP — deploy Playwright MCP server, verify browser + frontend-tester graphs work end-to-end
2. **New task**: Steel.dev Docker integration — add to `infra/compose/`, session management, CDP endpoint wiring
3. **New task**: Browser session lifecycle — cleanup on graph completion, idle timeout, resource limits
4. **New task**: Credential broker integration — tenant-scoped browser sessions via `ConnectionBrokerPort`

### Key Invariant

**BROWSER_SESSION_ISOLATED**: Each graph execution that uses browser tools MUST get its own browser context. No session state leakage between executions. This is the security boundary.
