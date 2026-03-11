---
id: github-app-webhook-setup-guide
type: guide
title: GitHub App + Webhook Setup (Dev / Preview)
status: draft
trust: draft
summary: Create a GitHub App for attribution ingestion, configure webhook delivery via smee.io for local dev, and set secrets for preview/production.
read_when: Setting up GitHub webhook ingestion for the first time, onboarding a new dev environment, or debugging webhook delivery.
owner: derekg1729
created: 2026-03-06
verified: 2026-03-06
tags: [github, webhooks, ingestion, setup]
---

# GitHub App + Webhook Setup (Dev / Preview)

> Configure a GitHub App to deliver webhook events (PRs, reviews, issues, pushes) into the attribution ledger. Local dev uses smee.io as a proxy; preview/production receive webhooks directly.

## Prerequisites

- GitHub account with org admin (for org-level apps) or personal account access
- Repo cloned locally with a working `.env.local`
- `gh` CLI authenticated (`gh auth status`)
- Node.js installed (for `npx smee`)

## Architecture

The app has two ingestion paths that converge on the same `ingestion_receipts` table:

| Path        | Transport                                      | Where it runs      |
| ----------- | ---------------------------------------------- | ------------------ |
| **Poll**    | Temporal schedule -> GitHub GraphQL            | `scheduler-worker` |
| **Webhook** | GitHub -> `POST /api/internal/webhooks/github` | Next.js app        |

Both paths produce idempotent receipts (`ON CONFLICT DO NOTHING`). Webhooks provide near-instant ingestion; polling provides reconciliation.

## Step 1: Create a GitHub App

Go to **GitHub Settings -> Developer settings -> GitHub Apps -> New GitHub App** (or `https://github.com/settings/apps/new` for personal).

| Field          | Value                                             |
| -------------- | ------------------------------------------------- |
| App name       | `cogni-ingestion-dev-<yourname>`                  |
| Homepage URL   | `https://github.com/Cogni-DAO/cogni-template`     |
| Webhook URL    | See Step 2 (smee for local, real URL for preview) |
| Webhook secret | Generate: `openssl rand -hex 20`                  |
| Webhook active | Checked                                           |

### Permissions (Repository)

| Permission    | Access                   | Why                                 |
| ------------- | ------------------------ | ----------------------------------- |
| Checks        | Read & write             | PR review bot creates Check Runs    |
| Contents      | Read-only                | Read repo files, diffs              |
| Issues        | Read-only                | Attribution ingestion               |
| Metadata      | Read-only (auto-granted) |                                     |
| Pull requests | Read & write             | PR review bot posts comments on PRs |

### Subscribe to events

- Issues
- Issue comment
- Pull request
- Pull request review
- Push

### Where can this app be installed?

- **Only on this account** (for dev apps)

Click **Create GitHub App**. Note the **App ID** from the app settings page.

## Step 2: Generate a private key

On the app settings page, scroll to **Private keys -> Generate a private key**. Download the `.pem` file, then base64-encode it:

```bash
base64 < ~/Downloads/cogni-ingestion-dev-yourname.*.private-key.pem | tr -d '\n'
```

## Step 3: Install the app on your test repo

On the app settings page: **Install App -> (your account) -> Only select repositories -> choose your test repo** (e.g. `derekg1729/test-repo`).

## Step 4: Configure environment variables

Add to `.env.local`:

```bash
GH_REVIEW_APP_ID=<app-id-from-step-1>
GH_REVIEW_APP_PRIVATE_KEY_BASE64=<base64-from-step-2>
GH_REPOS=<owner>/<test-repo>
GH_WEBHOOK_SECRET=<secret-from-step-1>
```

## Step 5: Webhook delivery — local dev (smee.io)

GitHub can't reach `localhost`. Use [smee.io](https://smee.io) to proxy webhook deliveries to your machine.

### 5a. Create a smee channel

Go to **https://smee.io/new** — copy the channel URL (e.g. `https://smee.io/AbCdEf123456`).

### 5b. Set the GitHub App's webhook URL to your smee channel

On the app settings page: **Webhook URL** -> paste the smee channel URL.

### 5c. Add the smee URL to `.env.local`

```bash
GH_WEBHOOK_PROXY_URL=https://smee.io/AbCdEf123456
```

### 5d. Run the smee client

In a separate terminal:

```bash
pnpm dev:smee
```

This reads `GH_WEBHOOK_PROXY_URL` from `.env.local` and forwards every webhook delivery from GitHub -> smee.io -> your local app.

> **Tip:** Open your smee channel URL in a browser to see deliveries in real-time.

### 5e. Start the app

```bash
pnpm dev:stack
```

Now push a commit or open a PR on your test repo — you should see the webhook arrive in the smee dashboard and get forwarded to your local app.

## Step 5 (alt): Webhook delivery — preview / production

For deployed environments, the GitHub App's webhook URL points directly at the app:

| Environment | Webhook URL                                                 |
| ----------- | ----------------------------------------------------------- |
| Preview     | `https://preview.cognidao.org/api/internal/webhooks/github` |
| Production  | `https://www.cognidao.org/api/internal/webhooks/github`     |

Set the secret as a GitHub Actions environment secret:

```bash
# Preview
gh secret set GH_WEBHOOK_SECRET --repo Cogni-DAO/cogni-template --env preview --body "$GH_WEBHOOK_SECRET"

# Production
gh secret set GH_WEBHOOK_SECRET --repo Cogni-DAO/cogni-template --env production --body "$GH_WEBHOOK_SECRET"
```

## Triggering test events

Full flow from a fresh setup to seeing real GitHub events in the UI:

```bash
# 1. Start infrastructure (postgres, temporal, scheduler-worker, etc.)
pnpm dev:infra

# 2. Provision + migrate + seed the database
#    Seeds 4 epochs including an open epoch for the current week
pnpm db:setup

# 3. Start the Next.js app (Terminal 1)
pnpm dev

# 4. Start the smee webhook proxy (Terminal 2)
pnpm dev:smee

# 5. Create real GitHub fixtures (Terminal 3)
#    Creates a merged PR + closed issue on the test repo
pnpm dev:trigger-github
```

The script targets `derekg1729/test-repo` by default. Override with `E2E_GITHUB_REPO` in `.env.local`.

GitHub fires webhooks → smee forwards → app inserts receipts → visible in `/gov/epoch` within seconds (the seeded open epoch covers the current week).

## Verifying it works

### Check webhook delivery

1. Run `pnpm dev:trigger-github` (or push a commit to your test repo)
2. Check the GitHub App's **Advanced -> Recent Deliveries** for green checkmarks
3. Check smee.io dashboard (local dev) for forwarded payloads
4. Check app logs for `webhook received` / `receipts inserted` messages

### Check the database

```sql
SELECT id, event_type, metadata->>'repo' AS repo, retrieved_at
FROM ingestion_receipts
WHERE source = 'github'
ORDER BY retrieved_at DESC
LIMIT 10;
```

### Re-deliver a webhook

On the GitHub App settings page: **Advanced -> Recent Deliveries -> pick one -> Redeliver**. Useful for debugging without creating new PRs/pushes.

## Troubleshooting

| Symptom                                | Cause                                | Fix                                                                                 |
| -------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| 404 from webhook route                 | `GH_WEBHOOK_SECRET` not set or empty | Set the env var and restart                                                         |
| 401 from webhook route                 | Secret mismatch                      | Ensure `.env.local` secret matches the GitHub App's webhook secret                  |
| No deliveries in smee dashboard        | Wrong webhook URL in GitHub App      | Update to your smee channel URL                                                     |
| Deliveries in smee but no forwarding   | smee client not running              | Run `npx smee -u <url> -t http://localhost:3000/api/internal/webhooks/github`       |
| Deliveries in smee but app returns 500 | App not running or crash             | Check `pnpm dev:stack` logs                                                         |
| Events arrive but zero receipts        | Normalizer filtering them            | Check `event_type` — bot authors are filtered, unsupported event types return empty |

## Reference

- Webhook route: `src/app/api/internal/webhooks/[source]/route.ts`
- Normalizer: `src/adapters/server/ingestion/github-webhook.ts`
- Feature service: `src/features/ingestion/services/webhook-receiver.ts`
- Architecture decision: `docs/research/webhook-ingestion-architecture.md`
- Attribution ledger spec: `docs/spec/attribution-ledger.md`
- Unit tests: `tests/unit/adapters/server/ingestion/github-webhook-normalizer.test.ts`
