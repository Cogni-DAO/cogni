---
id: oauth-app-setup-guide
type: guide
title: OAuth App Setup (GitHub + Google)
status: draft
trust: draft
summary: Create GitHub and Google OAuth apps for dev and production environments. Covers app registration, callback URLs, env vars, and consent screen configuration.
read_when: Setting up OAuth sign-in for the first time, adding a new environment, or rotating OAuth credentials.
owner: derekg1729
created: 2026-02-28
verified: 2026-02-28
tags: [auth, oauth, setup]
---

# OAuth App Setup (GitHub + Google)

> Register OAuth apps with GitHub and Google so users can sign in. You need **two apps per provider** — one for local dev, one for production. Takes ~15 minutes per provider.

## Prerequisites

- Access to a GitHub account with permission to create OAuth Apps
- Access to a Google Cloud project (or ability to create one)
- The repo cloned locally with a working `.env.local`
- Your production domain (e.g. `https://www.cognidao.org`)

## How It Works

`src/auth.ts` conditionally registers each OAuth provider only when both `CLIENT_ID` and `CLIENT_SECRET` env vars are set. No code changes needed — just add the env vars.

**Callback URL pattern** (NextAuth v4):

```
{NEXTAUTH_URL}/api/auth/callback/{provider}
```

| Environment | Base URL                | GitHub Callback                                  | Google Callback                                  |
| ----------- | ----------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Dev         | `http://localhost:3000` | `http://localhost:3000/api/auth/callback/github` | `http://localhost:3000/api/auth/callback/google` |
| Production  | `https://app.cogni.dev` | `https://app.cogni.dev/api/auth/callback/github` | `https://app.cogni.dev/api/auth/callback/google` |

> Replace `app.cogni.dev` with your actual production domain throughout this guide.

---

## 1. GitHub OAuth Apps

GitHub OAuth Apps only support **one callback URL each**, so you need a separate app for dev and production.

### 1a. Create the Dev App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   (`https://github.com/settings/applications/new`)

2. Fill in:

   | Field                      | Value                                            |
   | -------------------------- | ------------------------------------------------ |
   | Application name           | `Cogni (dev)`                                    |
   | Homepage URL               | `http://localhost:3000`                          |
   | Authorization callback URL | `http://localhost:3000/api/auth/callback/github` |

3. Click **Register application**

4. On the app page:
   - Copy the **Client ID**
   - Click **Generate a new client secret** — copy it immediately (you won't see it again)

5. Add to `.env.local`:

   ```env
   GITHUB_OAUTH_CLIENT_ID=<your-dev-client-id>
   GITHUB_OAUTH_CLIENT_SECRET=<your-dev-client-secret>
   ```

### 1b. Create the Production App

Repeat the same steps with production values:

| Field                      | Value                                            |
| -------------------------- | ------------------------------------------------ |
| Application name           | `Cogni`                                          |
| Homepage URL               | `https://app.cogni.dev`                          |
| Authorization callback URL | `https://app.cogni.dev/api/auth/callback/github` |

Add the credentials to your production environment (Vercel, Railway, etc.) as `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.

### GitHub Checklist

- [ ] Dev app created, credentials in `.env.local`
- [ ] Production app created, credentials in production env
- [ ] Dev sign-in tested (creates user + `user_bindings` row with `provider=github`)

---

## 2. Google OAuth Clients

Google uses a single project but supports multiple redirect URIs per client. You can use **one client** with both dev and prod redirect URIs, or create separate clients. Separate clients is cleaner.

### 2a. Set Up the Google Cloud Project (once)

1. Go to **Google Cloud Console → APIs & Services → Credentials**
   (`https://console.cloud.google.com/apis/credentials`)

2. Create a project if you don't have one (e.g. `cogni`)

3. **Configure the OAuth consent screen** (left sidebar → OAuth consent screen):

   | Field              | Value                        |
   | ------------------ | ---------------------------- |
   | User Type          | **External**                 |
   | App name           | `Cogni`                      |
   | User support email | your email                   |
   | Scopes             | `email`, `profile`, `openid` |
   | Test users         | add your Google email(s)     |

   > While the app is in **Testing** status, only listed test users can sign in (100 user cap). This is fine for dev. Submit for verification when you're ready for production.

### 2b. Create the Dev Client

1. Go to **Credentials → Create Credentials → OAuth client ID**

2. Fill in:

   | Field                         | Value                                            |
   | ----------------------------- | ------------------------------------------------ |
   | Application type              | **Web application**                              |
   | Name                          | `Cogni (dev)`                                    |
   | Authorized JavaScript origins | `http://localhost:3000`                          |
   | Authorized redirect URIs      | `http://localhost:3000/api/auth/callback/google` |

3. Click **Create** — copy the **Client ID** and **Client Secret**

4. Add to `.env.local`:

   ```env
   GOOGLE_OAUTH_CLIENT_ID=<your-dev-client-id>
   GOOGLE_OAUTH_CLIENT_SECRET=<your-dev-client-secret>
   ```

### 2c. Create the Production Client

Create a second OAuth client ID in the same project:

| Field                         | Value                                            |
| ----------------------------- | ------------------------------------------------ |
| Application type              | **Web application**                              |
| Name                          | `Cogni`                                          |
| Authorized JavaScript origins | `https://app.cogni.dev`                          |
| Authorized redirect URIs      | `https://app.cogni.dev/api/auth/callback/google` |

Add the credentials to your production environment as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

### Google Checklist

- [ ] Google Cloud project created, consent screen configured
- [ ] Dev client created, credentials in `.env.local`
- [ ] Production client created, credentials in production env
- [ ] Test users added to consent screen (required while in Testing mode)
- [ ] Dev sign-in tested (creates user + `user_bindings` row with `provider=google`)

---

## Verify

After adding env vars, restart the dev server:

```bash
pnpm dev
```

Providers auto-register when both `CLIENT_ID` and `CLIENT_SECRET` are non-empty (`src/auth.ts:203-226`). No code changes or feature flags needed.

### What to Check

1. **Sign in** via GitHub or Google from the sign-in page
2. **User created** — `users` row with `walletAddress: null`
3. **Binding created** — `user_bindings` row with correct `provider` and `external_id`
4. **Session** — `session.user.id` is a UUID, `session.user.walletAddress` is `null`
5. **Idempotent** — signing in again with the same account returns the same user

### Account Linking

If you're already signed in (e.g. via wallet), you can link an OAuth provider from the profile page. This creates a binding for your existing user instead of creating a new one. See the [authentication spec](../spec/authentication.md) for details.

---

## Env Var Reference

| Variable                     | Required | Where                   |
| ---------------------------- | -------- | ----------------------- |
| `NEXTAUTH_URL`               | Yes      | `.env.local`            |
| `NEXTAUTH_SECRET`            | Yes      | `.env.local`            |
| `GITHUB_OAUTH_CLIENT_ID`     | No\*     | `.env.local` / prod env |
| `GITHUB_OAUTH_CLIENT_SECRET` | No\*     | `.env.local` / prod env |
| `GOOGLE_OAUTH_CLIENT_ID`     | No\*     | `.env.local` / prod env |
| `GOOGLE_OAUTH_CLIENT_SECRET` | No\*     | `.env.local` / prod env |

\*Optional — provider is silently skipped if either value is missing.

---

## Troubleshooting

| Symptom                          | Cause                                                  | Fix                                                                |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Provider not showing on sign-in  | Missing or empty `CLIENT_ID` / `CLIENT_SECRET`         | Check `.env.local`, restart dev server                             |
| "redirect_uri_mismatch" (Google) | Callback URL doesn't match registered redirect URI     | Verify exact URL in Google Cloud Console (trailing slashes matter) |
| "redirect_uri_mismatch" (GitHub) | Callback URL doesn't match registered callback URL     | Verify exact URL in GitHub OAuth App settings                      |
| Google "Access blocked" screen   | App in Testing mode, your email not in test users list | Add your email to OAuth consent screen → Test users                |
| Google "unverified app" warning  | App not verified (expected in dev)                     | Click "Advanced" → "Go to Cogni (unsafe)" to proceed               |
| Sign-in succeeds but no user row | DB connection issue                                    | Check Postgres is running, `DATABASE_URL` is correct               |

## Related

- [Authentication Spec](../spec/authentication.md) — full auth flow design, invariants, session model
- [Identity Model](../spec/identity-model.md) — `user_id`, `user_bindings`, identity primitives
- [Developer Setup](./developer-setup.md) — general env setup
