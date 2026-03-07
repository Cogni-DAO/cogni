---
id: developer-setup-guide
type: guide
title: Developer Setup
status: draft
trust: draft
summary: First-time setup, daily development workflow, and testing commands for the Cogni-Template repo.
read_when: Onboarding to the repo or need a quick reference for dev/test commands.
owner: derekg1729
created: 2026-02-06
verified: 2026-02-06
tags: [dev, onboarding]
---

# Developer Setup

## When to Use This

You are setting up the Cogni-Template repo for the first time, or need a reference for daily development and testing commands.

## Preconditions

- [ ] Node.js 22+ installed
- [ ] pnpm installed (`corepack enable`)
- [ ] Repository cloned
- [ ] Docker running (for infrastructure services)

## Steps

### First Time Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Environment files:**

   ```bash
   cp .env.local.example .env.local
   cp .env.test.example .env.test
   ```

3. **Setup development database:**

   ```bash
   pnpm db:setup
   ```

4. **Discord bot (optional):**
   If you want the OpenClaw gateway to connect a Discord bot, add `DISCORD_BOT_TOKEN` to `.env.local`. See [Discord Bot Setup](./discord-bot-setup.md) for full instructions.

## Daily Development

```bash
pnpm dev:stack          # Start app + infrastructure (main workflow)
```

## Testing

**Host Stack Tests:**

```bash
pnpm dev:stack:test:setup   # Create test database + migrations
pnpm test:stack:dev         # Run stack tests against host app
pnpm dev:stack:test:reset   # Nuclear reset when test DB is corrupted
```

**Docker Stack Tests:**

```bash
pnpm docker:test:stack          # Start containerized test stack
pnpm docker:test:stack:setup    # Create test database + migrations (requires stack running)
pnpm test:stack:docker          # Run tests against containerized app
pnpm docker:test:stack:reset    # Nuclear reset for containerized test database
```

## GitHub Webhook Testing (optional)

Test real GitHub event ingestion end-to-end. Requires a GitHub App configured for webhooks — see [GitHub App + Webhook Setup](./github-app-webhook-setup.md) for first-time setup.

```bash
# 1. Start infrastructure (postgres, temporal, scheduler-worker, etc.)
pnpm dev:infra

# 2. Provision + migrate + seed the database (creates open epoch for current week)
pnpm db:setup

# 3. Start the Next.js app (Terminal 1)
pnpm dev

# 4. Start the smee webhook proxy (Terminal 2)
pnpm dev:smee

# 5. Trigger real GitHub events — creates a merged PR + closed issue (Terminal 3)
pnpm dev:trigger-github
```

Receipts appear in `/gov/epoch` within seconds. The seeded open epoch covers the current week, so new webhook receipts show up immediately.

## Available Modes

- `pnpm dev:stack` - Host app + containerized postgres/litellm
- `pnpm docker:test:stack` - All services containerized for testing (production-like)
- `pnpm docker:stack` - Full production simulation with local environment

**Fast variants:** Add `:fast` to skip rebuilds (e.g., `pnpm docker:test:stack:fast`)

See [Environments](../spec/environments.md) for deployment modes and [Databases](../spec/databases.md) for migration details.

## Verification

```bash
pnpm check          # lint + type + format validation
pnpm test           # run unit tests (no infra required)
```

## Claude Code Remote Sessions

If you use [Claude Code on the web](https://claude.ai/code) (remote sessions), you **must** configure git authorship in your environment. Without this, the SessionStart hook will fail and block the session — this is intentional to prevent commits attributed to "Claude".

1. Go to [claude.ai/code](https://claude.ai/code) → click your environment → edit (or create one)
2. Add these environment variables:
   ```
   GIT_AUTHOR_NAME=<your git username>
   GIT_AUTHOR_EMAIL=<your git email>
   ```
3. Set **Network access** to "Full" if you need `gh` CLI access for PR operations

The repo's `.claude/settings.json` SessionStart hook reads these vars and configures `git config` automatically.

## Troubleshooting

### Problem: `pnpm db:setup` fails with connection error

**Solution:** Ensure Docker is running and postgres container is healthy: `docker ps | grep postgres`.

### Problem: Port conflicts on `pnpm dev:stack`

**Solution:** Check for existing processes on ports 3000/5432: `lsof -i :3000` and kill if needed.

## Related

- [Environments Spec](../spec/environments.md) — deployment modes and stack configurations
- [Databases Spec](../spec/databases.md) — migration architecture and database setup
- [Testing Guide](./testing.md) — testing strategy and adapter patterns
- [Discord Bot Setup](./discord-bot-setup.md) — connect a Discord bot to the OpenClaw gateway
