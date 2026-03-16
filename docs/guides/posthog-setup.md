---
id: posthog-setup-guide
type: guide
title: PostHog Setup
status: active
trust: draft
summary: Set up PostHog Cloud for production analytics and optional self-hosted PostHog for local dev.
read_when: First-time setup, or when PostHog secrets are missing in CI/deploy.
owner: derekg1729
created: 2026-03-13
verified: 2026-03-13
tags: [analytics, onboarding]
---

# PostHog Setup

## When to Use This

You need to configure PostHog product analytics. This is required — the app will not start without `POSTHOG_API_KEY` and `POSTHOG_HOST`.

## Production Setup (PostHog Cloud)

### Preconditions

- [ ] GitHub repo admin access (to set environment secrets)
- [ ] `gh` CLI authenticated (`gh auth status`)

### Steps

1. **Sign up** at [posthog.com](https://posthog.com) — use GitHub SSO. No credit card required.

2. **Create a project.** PostHog prompts you on first login.

3. **Skip the "install snippet" step.** Server-side capture is already wired.

4. **Collect three values from Project Settings** (gear icon → left sidebar):

   | Value               | Where to find it              | Example                            |
   | ------------------- | ----------------------------- | ---------------------------------- |
   | **Project API Key** | Project Settings → API Key    | `phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
   | **Project ID**      | Project Settings → Project ID | `341476`                           |
   | **Host**            | (fixed per region)            | `https://us.i.posthog.com`         |

5. **Set GitHub secrets.** Replace the placeholder values and run:

   > **Note:** PostHog free tier supports one project. Both preview and production share the same key/project. Separate projects per environment is a paid feature — use the same values for both until then.

   ```bash
   # Production environment
   gh secret set POSTHOG_API_KEY --env production --body "phc_YOUR_KEY"
   gh secret set POSTHOG_HOST --env production --body "https://us.i.posthog.com"
   gh secret set POSTHOG_PROJECT_ID --env production --body "YOUR_PROJECT_ID"

   # Preview environment (same project — separate projects require paid plan)
   gh secret set POSTHOG_API_KEY --env preview --body "phc_YOUR_KEY"
   gh secret set POSTHOG_HOST --env preview --body "https://us.i.posthog.com"
   gh secret set POSTHOG_PROJECT_ID --env preview --body "YOUR_PROJECT_ID"
   ```

6. **Add to `.env.local`** (local dev pointing at PostHog Cloud):

   ```bash
   POSTHOG_API_KEY=phc_YOUR_KEY
   POSTHOG_HOST=https://us.i.posthog.com
   POSTHOG_PROJECT_ID=YOUR_PROJECT_ID
   ```

### Verify

```bash
pnpm dev:stack
```

Check app logs — no `POSTHOG_API_KEY` validation errors. Events will flow to PostHog Cloud on auth sign-in, credit purchase, etc.

---

## Local Dev Setup (Self-Hosted, Optional)

Self-hosted PostHog for offline development. Requires ~4GB RAM.

### Preconditions

- [ ] Docker running with at least 4GB RAM allocated

### Steps

1. **Start the PostHog stack:**

   ```bash
   pnpm posthog:up
   ```

   Wait ~60 seconds for all services to become healthy.

2. **Create an account:** Open `http://localhost:8000` → create admin user → create project.

3. **Copy values:** Project Settings → Project API Key + Project ID.

4. **Add to `.env.local`:**

   ```bash
   POSTHOG_API_KEY=phc_your_key_from_step_3
   POSTHOG_HOST=http://localhost:8000
   POSTHOG_PROJECT_ID=1
   ```

### Stop / Reset

```bash
pnpm posthog:down     # stop, keep data
pnpm posthog:nuke     # stop and delete all data
```

---

## Troubleshooting

### Problem: App fails to start with "POSTHOG_API_KEY" validation error

**Solution:** Add the env vars. For local dev, copy from `.env.local.example`. For CI, check that GitHub environment secrets are set (see Production Setup above).

### Problem: Events not appearing in PostHog dashboard

**Solution:** Events are batched (50 events or 5 seconds). Wait a few seconds, then check PostHog → Activity → Live Events. Verify host is `https://us.i.posthog.com` (not `http://`).

## Related

- [PostHog Spec](../spec/posthog.md) — architecture decision, capture contract, event envelope
- [Event Taxonomy v0](../analytics/events.v0.md) — event names and payload schemas
- [Developer Setup](./developer-setup.md) — full repo onboarding
