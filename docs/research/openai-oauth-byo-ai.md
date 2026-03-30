---
id: openai-oauth-byo-ai
type: research
title: "OpenAI Codex OAuth & BYO-AI Integration"
status: active
trust: reviewed
verified: 2026-03-22
summary: "Research into OpenClaw's OpenAI Codex OAuth implementation and how to adopt it for cogni-template BYO-AI feature."
read_when: "Building BYO-AI features, integrating Codex OAuth, or evaluating per-tenant LLM credential management."
owner: derekg1729
created: 2026-03-22
tags: [ai, oauth, byo-ai, cost-control, openai]
---

# Research: OpenAI Codex OAuth & BYO-AI

> spike: spike.openai-oauth-byo-ai | date: 2026-03-22

## Question

How does OpenClaw implement OpenAI Codex OAuth (ChatGPT subscription login), and how can we adopt it into cogni-template so that (v0) an experiment branch "just works" with a Codex subscription, and (v1) per-tenant users can sign in with their own subscription (BYO-AI)?

## Context

Today, cogni-template routes all LLM traffic through a single LiteLLM proxy backed by a shared OpenRouter API key (`OPENROUTER_API_KEY`). This creates two problems:

1. **Cost concentration** -- all spend hits one key/account, with weekly limits and Opus burn risk (see MEMORY: $20 in 30 minutes on 2/14/2026).
2. **No user-level subscriptions** -- users with ChatGPT Plus/Pro/Team subscriptions (which include Codex access at $0 marginal cost) cannot use their own quota.

OpenClaw already ships production-grade OpenAI Codex OAuth. We want to understand the exact mechanism and adopt it.

## Findings

### The OpenAI Codex OAuth Flow (Extracted from OpenClaw)

The complete flow lives across three layers:

#### Layer 1: `@mariozechner/pi-ai/oauth` (npm package)

This package contains the raw PKCE OAuth implementation. Key constants:

```
CLIENT_ID     = "app_EMoamEEZ73f0CkXaXp7hrann"
AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
TOKEN_URL     = "https://auth.openai.com/oauth/token"
REDIRECT_URI  = "http://localhost:1455/auth/callback"
SCOPE         = "openid profile email offline_access"
```

**Login flow:**

1. Generate PKCE verifier + SHA256 challenge
2. Build authorize URL with params: `response_type=code`, `client_id`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method=S256`, `state`, `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`
3. Start local HTTP server on `127.0.0.1:1455`, listening for `/auth/callback`
4. Open browser to authorize URL (or show URL for manual paste on VPS)
5. User logs in to ChatGPT, grants consent
6. Callback receives `?code=...&state=...` -- validates state, extracts code
7. Exchange code for tokens: POST to `TOKEN_URL` with `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `redirect_uri`
8. Response: `{ access_token, refresh_token, expires_in }`
9. Decode JWT to extract `accountId` from claim path `https://api.openai.com/auth` -> `chatgpt_account_id`
10. Return `{ access, refresh, expires, accountId }`

**Refresh flow:**

- POST to `TOKEN_URL` with `grant_type=refresh_token`, `refresh_token`, `client_id`
- Re-extract `accountId` from new access token JWT

**Key insight:** The `CLIENT_ID` is OpenAI's public Codex CLI client (`app_EMoamEEZ73f0CkXaXp7hrann`). This is a public OAuth client (no client_secret required) -- PKCE replaces the secret.

#### Layer 2: OpenClaw Plugin Wrappers

- `src/plugins/provider-openai-codex-oauth.ts` -- TLS preflight + VPS-aware handlers (54 lines of wrapper)
- `src/plugins/provider-oauth-flow.ts` -- `createVpsAwareOAuthHandlers()` for local vs. remote environments
- `src/plugins/provider-openai-codex-oauth-tls.ts` -- Validates TLS certs for `auth.openai.com` (Homebrew OpenSSL fix)

#### Layer 3: Credential Storage & Refresh

- `src/agents/auth-profiles/types.ts` -- Three credential types: `ApiKeyCredential`, `TokenCredential`, `OAuthCredential`
- `src/agents/auth-profiles/store.ts` -- File-based persistence at `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`
- `src/agents/auth-profiles/oauth.ts` -- Token refresh with file locking, fallback chains, expiry checking

#### Runtime API Usage

Once authenticated, API calls go to:

- **Base URL:** `https://chatgpt.com/backend-api` (NOT the standard OpenAI API)
- **Auth header:** `Authorization: Bearer {access_token}`
- **Account header:** `ChatGPT-Account-Id: {accountId}` (routes to correct subscription)
- **Usage endpoint:** `GET https://chatgpt.com/backend-api/wham/usage` -- returns plan_type, credit balance, rate limit windows
- **Transport:** WebSocket (primary) with SSE fallback (`transport: "auto"`)
- **API style:** `openai-codex-responses` (not standard `openai-chat`)

#### Models Available via Codex Subscription

```
gpt-5.4         (1.05M context, 128K max output)
gpt-5.3-codex   (default)
gpt-5.3-codex-spark (128K context, lighter)
gpt-5.2-codex
gpt-5.1-codex
gpt-5.1-codex-mini
gpt-5.1-codex-max
```

### Option A: Direct `@mariozechner/pi-ai` Integration (v0 Experiment)

**What:** Install `@mariozechner/pi-ai` as a dependency, use `loginOpenAICodex()` directly to obtain tokens, configure LiteLLM to route through the Codex backend.

**Pros:**

- Minimal code -- the npm package does all the heavy lifting
- Same client ID as OpenClaw/Codex CLI (proven, public)
- PKCE flow is standard OAuth 2.1, no client secret needed
- Get up and running in hours

**Cons:**

- `@mariozechner/pi-ai` is a CLI-focused package (Node.js only, uses `node:http` for callback server)
- For a web app, we'd need a browser-compatible OAuth redirect flow instead of a local HTTP server
- The Codex API uses a non-standard base URL (`chatgpt.com/backend-api`) and transport (WebSocket)
- LiteLLM may not natively support the `openai-codex-responses` API variant
- Depends on a third-party package for auth flow

**Fit with our system:** Poor for web-based auth, good for CLI/dev tooling. Could work as a dev-only feature where the developer runs a login command locally.

### Option B: Server-Side OAuth Redirect Flow (v1 Production)

**What:** Implement standard OAuth 2.0 authorization code + PKCE flow as a Next.js API route, using OpenAI's public OAuth endpoints directly (no `@mariozechner/pi-ai` dependency).

**Pros:**

- Browser-native: user clicks "Sign in with OpenAI" -> redirected to `auth.openai.com` -> redirected back to our callback route
- Works with our existing Auth.js stack (add as another OAuth provider)
- Per-tenant: each user gets their own `access_token` + `refresh_token` + `accountId`
- Tokens stored encrypted in DB, associated with `billing_account_id`
- No third-party dependency for the OAuth flow itself

**Cons:**

- Need to implement token refresh (cron or on-demand)
- Need to handle the Codex-specific API routing through LiteLLM (custom base URL, transport)
- OpenAI may change the public client ID or API surface (it's not an officially documented public API)
- Key storage security: encrypted tokens in DB, key rotation

**Fit with our system:**

- Auth.js already handles OAuth (GitHub, Discord, Google) -- adding OpenAI is a natural extension
- `billing_accounts` table already has per-user structure -- add `provider_credentials` column or relation
- LiteLLM adapter already reads `billingAccountId` in caller metadata -- extend to resolve user's own API key
- Hexagonal architecture: new `OpenAICodexOAuthAdapter` behind existing `LlmService` port

### Option C: LiteLLM Virtual Keys with User-Provided Credentials

**What:** Use LiteLLM's built-in virtual key system to let each user configure their own provider keys.

**Pros:**

- LiteLLM already supports per-key API routing
- No custom OAuth needed for providers that use API keys
- Cost tracking comes for free via LiteLLM spend logs

**Cons:**

- Codex OAuth is NOT a simple API key -- it requires OAuth flow + token refresh
- Virtual keys don't support OAuth token lifecycle management
- Would only work for standard OpenAI API keys (not Codex subscriptions)

**Fit with our system:** Complementary for BYO-API-key (Option C+B), but insufficient alone for Codex OAuth.

### Key Technical Details for Integration

#### The `CLIENT_ID` Question

The client ID `app_EMoamEEZ73f0CkXaXp7hrann` is used by both:

- OpenAI's official Codex CLI
- OpenClaw's integration (via `@mariozechner/pi-ai`)

This is a **public client** (no secret). It appears to be OpenAI's intentional public client for third-party CLI integrations. The `codex_cli_simplified_flow=true` parameter suggests OpenAI designed this specifically for CLI tools.

For a web app redirect flow, we'd use the same client ID but change the `redirect_uri` to our web callback endpoint. **Risk:** OpenAI may restrict allowed redirect URIs for this client ID. If so, we'd need to register our own OAuth application with OpenAI (if they offer this -- currently unclear).

#### LiteLLM Routing for Codex

LiteLLM supports custom base URLs per model. We'd add a model config like:

```yaml
- model_name: codex/gpt-5.3
  litellm_params:
    model: openai/gpt-5.3-codex
    api_base: https://chatgpt.com/backend-api
    api_key: "dynamic" # resolved per-request from user's OAuth token
```

**Unknown:** Whether LiteLLM handles the Codex-specific response format and WebSocket transport. May need to bypass LiteLLM for Codex calls and hit the API directly.

#### Token Storage

```
billing_accounts
  └── provider_credentials (new table)
        ├── billing_account_id (FK)
        ├── provider: "openai-codex"
        ├── access_token_enc: bytea (encrypted)
        ├── refresh_token_enc: bytea (encrypted)
        ├── expires_at: timestamp
        ├── account_id: text (ChatGPT account ID)
        ├── email: text
        ├── created_at, updated_at
        └── encryption_key_id (for key rotation)
```

## Recommendation

**Two-phase approach:**

### v0: CLI Login Experiment (branch, hours of work)

1. Install `@mariozechner/pi-ai` as a dev dependency
2. Create a CLI script: `pnpm codex:login` -- runs the PKCE flow locally, stores tokens in `.env.local`
3. Add a LiteLLM model entry for `codex/*` models with the stored access token
4. Add a token refresh check at dev server startup
5. **No web UI, no per-tenant support** -- just the developer's own Codex subscription powering the dev environment

This unblocks immediate cost savings for developers with Codex subscriptions.

### v1: Per-Tenant BYO-AI (project, weeks of work)

1. Add OpenAI Codex as an Auth.js OAuth provider (browser redirect flow)
2. Create `provider_credentials` table with encrypted token storage
3. Extend `LlmService` port to resolve per-user credentials
4. Modify LiteLLM adapter to inject user tokens for Codex-routed models
5. Build UI: "Connect your OpenAI subscription" in account settings
6. Token refresh cron/middleware
7. Usage tracking per-user (Codex usage API integration)

**Trade-offs accepted:**

- Using OpenAI's public client ID (risk: OpenAI may change it; mitigation: version-pin, monitor)
- Codex API is not officially documented for third-party use (risk: breaking changes; mitigation: OpenClaw community tracks this)
- WebSocket transport may not work through LiteLLM (mitigation: direct API adapter as fallback)

## Open Questions

1. **Redirect URI restrictions:** Does OpenAI's public client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) accept arbitrary `redirect_uri` values, or is it locked to `localhost:1455`? If locked, v1 needs OpenAI to register our app (or we use a localhost relay pattern).

2. **LiteLLM Codex transport:** Does LiteLLM support the `openai-codex-responses` API variant and WebSocket transport? If not, we need a direct adapter that bypasses LiteLLM for Codex calls.

3. **OpenAI OAuth app registration:** Does OpenAI offer a self-service OAuth app registration for the Codex API? If yes, we should register our own client ID rather than reusing the CLI one.

4. **Rate limits & subscription tiers:** How do Codex rate limits differ across Plus ($20/mo), Pro ($200/mo), and Team plans? This affects how we present the BYO option to users.

5. **Token lifetime:** How long do Codex access tokens last before needing refresh? The `expires_in` field tells us at runtime, but knowing the typical TTL helps design the refresh strategy (cron interval vs. on-demand).

6. **Multi-provider BYO:** Should v1 support BYO for other providers (Anthropic, Google, etc.) from the start, or focus solely on Codex? Architecture should be provider-agnostic, but scope should be narrow.

## Proposed Layout

### Project: `proj.byo-ai`

**Goal:** Enable users to connect their own AI provider subscriptions, starting with OpenAI Codex OAuth.

**Phases:**

- **Crawl (v0):** CLI login script for developer's own Codex subscription in dev environment
- **Walk (v1):** Per-tenant OAuth flow, encrypted credential storage, per-user LLM routing
- **Run (v2):** Multi-provider BYO (Anthropic, Google), usage dashboards, spend limits

### Specs Needed

1. **`byo-ai-spec.md`** -- Provider credential lifecycle (OAuth flow, storage, refresh, revocation), encryption requirements, LLM routing integration, security model
2. **Update `accounts-design.md`** -- Add `provider_credentials` relation to billing accounts model
3. **Update `architecture.md`** -- Document the per-user credential resolution in the LLM adapter layer

### Tasks (Rough Sequence)

#### v0 (Experiment)

1. `task.XXX` -- Create `scripts/codex-login.ts` CLI tool using `@mariozechner/pi-ai` PKCE flow
2. `task.XXX` -- Add LiteLLM model config for Codex models with env-based token
3. `task.XXX` -- Token refresh on dev server startup (check expiry, refresh if needed)

#### v1 (Per-Tenant)

4. `task.XXX` -- Design & spec: BYO-AI credential lifecycle and security model
5. `task.XXX` -- DB migration: `provider_credentials` table with encrypted columns
6. `task.XXX` -- OAuth callback route: `POST /api/v1/auth/openai-codex/callback`
7. `task.XXX` -- Token refresh service (background worker or on-demand middleware)
8. `task.XXX` -- Extend `LlmService` port + adapter for per-user credential resolution
9. `task.XXX` -- UI: "Connect OpenAI" in account settings page
10. `task.XXX` -- Contract + integration tests for credential lifecycle
