---
id: bug.0276
type: bug
title: "K8s deployed app crashes to white — client-side exception after initial render"
status: needs_triage
priority: 0
rank: 1
estimate: 2
summary: "test.cognidao.org renders the homepage for ~1 second then crashes to white with 'Application error: a client-side exception has occurred'. /livez and /readyz return 200 — server is healthy, client JS bundle fails. Likely missing env vars (NEXT_PUBLIC_*), hydration mismatch, or SSR/client divergence in k8s vs Compose deploy."
outcome: "test.cognidao.org renders fully without client-side crash."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-03
updated: 2026-04-03
labels: [bug, deployment, k8s, p0]
external_refs:
---

# K8s App Client-Side Crash

## Symptoms

- test.cognidao.org homepage renders for ~1 second, then crashes to white
- Browser console shows: "Application error: a client-side exception has occurred"
- /livez returns 200 (server process alive)
- /readyz returns 200 (server ready)
- poly-test.cognidao.org and resy-test.cognidao.org likely same issue

## Likely Causes (investigate in order)

1. **Missing NEXT*PUBLIC*\* env vars** — k8s ConfigMap may not include NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID or other client-side env vars that were present in Compose deploy. These are baked at build time in Next.js — check if the Docker image was built with them.

2. **Hydration mismatch** — Server renders with one set of env/config, client JS expects different values. Common when DOMAIN or auth config differs between build-time and runtime.

3. **Missing browser polyfills** — WalletConnect/RainbowKit require browser APIs. If SSR renders wallet components that fail on client hydration.

4. **CSP or CORS** — Caddy or k3s ingress may be stripping headers that the client JS needs.

## Reproduce

```bash
curl -sk https://test.cognidao.org | head -50  # Check SSR HTML
# Open browser devtools → Console → look for the actual JS error
```

## Environment

- VM: 84.32.109.222
- k3s + Argo CD deployment
- Image: ghcr.io/cogni-dao/cogni-template:preview-{sha}
- Caddy edge → k3s NodePort 30000

## Validation

- [ ] Work item triaged and assigned
