---
id: bug.0306
type: bug
title: "GitHub OAuth broken across deployments — single callback app cannot serve multi-node origins"
status: needs_triage
priority: 0
rank: 1
estimate: 2
summary: "All deployed GitHub sign-in flows fail with GitHub's 'redirect_uri is not associated with this application' error because each node/environment serves NextAuth from a different origin while the same GitHub OAuth app/client_id is reused. GitHub OAuth Apps allow only one callback URL per app."
outcome: "GitHub sign-in works again on production/canary/preview, the deployed auth model is explicit, and OAuth provider configuration no longer depends on an impossible one-app-many-callback assumption."
spec_refs:
  - authentication-spec
  - identity-model-spec
  - ci-cd-spec
assignees: []
credit: []
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-08
updated: 2026-04-08
labels: [auth, oauth, deploy, identity]
external_refs:
  - "https://github.com/login/oauth/authorize?client_id=Ov23lirY21xiXmFej5IP&scope=read%3Auser%20user%3Aemail&response_type=code&redirect_uri=https%3A%2F%2Fcognidao.org%2Fapi%2Fauth%2Fcallback%2Fgithub"
---

# GitHub OAuth broken across deployments

## Requirements

### Observed

GitHub sign-in is failing on deployed environments with:

```text
Be careful!
The redirect_uri is not associated with this application.
```

The failing authorize URL uses:

```text
client_id=Ov23lirY21xiXmFej5IP
redirect_uri=https://cognidao.org/api/auth/callback/github
```

Current architecture facts:

1. Each deployed node runs its own NextAuth v4 instance and its own `/api/auth/[...nextauth]` route.
2. `NEXTAUTH_URL` is set per node/origin in k8s overlays:
   - operator production → `https://cognidao.org`
   - poly production → `https://poly.cognidao.org`
   - resy production → `https://resy.cognidao.org`
   - preview/canary use their own distinct hostnames too
3. `src/auth.ts` does not override `redirect_uri`; NextAuth derives it from `NEXTAUTH_URL`.
4. GitHub OAuth Apps support only one callback URL per app.

That means one shared `GH_OAUTH_CLIENT_ID` / `GH_OAUTH_CLIENT_SECRET` cannot legally serve:

- `https://cognidao.org/api/auth/callback/github`
- `https://poly.cognidao.org/api/auth/callback/github`
- `https://resy.cognidao.org/api/auth/callback/github`
- plus preview/canary equivalents

### Expected

1. GitHub sign-in must work on deployed environments.
2. The auth model must be explicit about whether OAuth is:
   - per-origin / per-node, or
   - centrally brokered by one auth origin.
3. Deployment docs and secrets management must reflect the actual callback model, not the current single-app assumption.

### Reproduction

```bash
# Production operator
open "https://github.com/login/oauth/authorize?client_id=Ov23lirY21xiXmFej5IP&scope=read%3Auser%20user%3Aemail&response_type=code&redirect_uri=https%3A%2F%2Fcognidao.org%2Fapi%2Fauth%2Fcallback%2Fgithub"

# Result:
# GitHub shows "The redirect_uri is not associated with this application."
```

Equivalent failures are expected on any deployment whose public origin does not exactly match the single callback URL registered in the GitHub OAuth app.

### Impact

- **Production GitHub sign-in broken**
- **Preview/canary sign-in broken**
- **Poly/resy per-node sign-in cannot scale with one GitHub OAuth app**
- Blocks acceptance testing for OAuth login and account linking
- Exposes an unresolved auth architecture gap: person identity is canonical across nodes, but OAuth session issuance is currently origin-local

## Allowed Changes

- `docs/guides/oauth-app-setup.md`
- `scripts/setup-secrets.ts`
- deployment env/secret wiring for OAuth credentials
- auth routing/config if needed to consolidate login under a single origin
- supporting specs/docs for auth identity ownership

## Plan

- [ ] Confirm the exact callback URL currently registered on the GitHub OAuth app behind `Ov23lirY21xiXmFej5IP`
- [ ] Unblock production/canary/preview by choosing one of two explicit paths:
- [ ] Path A: per-origin GitHub OAuth apps with matching per-env credentials
- [ ] Path B: centralize GitHub OAuth under one auth origin and redirect back into node apps after session establishment
- [ ] Document the chosen auth tenant/identity model: person identity (`user_id`) is global; OAuth session issuance is either origin-local or brokered centrally
- [ ] Update setup docs so new environments do not repeat this failure

## Validation

**Command / checks:**

```bash
# On each deployed origin that advertises GitHub sign-in
curl -I https://cognidao.org
curl -I https://poly.cognidao.org
curl -I https://resy.cognidao.org

# Manual:
# 1. Start GitHub sign-in
# 2. GitHub accepts the authorize request (no redirect_uri warning)
# 3. Callback completes
# 4. Session resolves to canonical users.id via user_bindings
```

**Expected:** GitHub authorize accepts the callback URL on every supported deployed origin, or all node apps intentionally route GitHub sign-in through one central auth origin.

## Review Checklist

- [ ] **Work Item:** `bug.0306` linked in PR body
- [ ] **Spec:** auth model documented clearly (person identity vs login origin)
- [ ] **Deploy:** production/canary/preview validated
- [ ] **Docs:** OAuth setup guide reflects the actual multi-node callback strategy

## PR / Links

- Related architecture fact: `user_id` is the canonical person identity, not wallet or OAuth provider ID
- Related deployment fact: `NEXTAUTH_URL` differs by node/environment in k8s overlays
- Screenshot evidence captured 2026-04-08 showing GitHub `redirect_uri` rejection
