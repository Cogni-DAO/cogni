---
id: chr.domains
type: charter
title: Domain Strategy Research
status: draft
state: Active
trust: draft
summary: Domain name research and shortlist for Cogni multi-node infrastructure
read_when: Planning DNS or domain acquisition for nodes
owner: derekg1729
created: 2026-04-01
updated: 2026-04-01
verified: null
tags: [dns, infrastructure]
---

# Domain Strategy Research

> Last updated: 2026-04-01 | Status: research / shortlist phase

## Goal

Identify and acquire the primary domain(s) for Cogni's multi-node infrastructure.

## Problem

`cognidao.org` is long. Node subdomains like `resy.nodes.cognidao.org` are painful.
Goal: find a shorter, memorable root domain for the Cogni network.

## Constraints

- Must be pronounceable by humans ("cogni" > "cogn" > "cgn")
- Node subdomains must feel natural: `resy.<domain>`, `poly.<domain>`
- Ideally buy from one registrar (Cloudflare preferred — wholesale pricing, already managing DNS)
- Budget-conscious but willing to pay for the right name

---

## Active Domains

| Domain           | Registrar | Renewal   | Expires    | DNS Provider           | Notes                                                         |
| ---------------- | --------- | --------- | ---------- | ---------------------- | ------------------------------------------------------------- |
| **cognidao.org** | Namecheap | $10.11/yr | 2027-04-06 | Cloudflare (alice/ian) | Primary domain. Renewed 2026-04-05 after grace period outage. |

### DNS Records — Canonical Mapping

```
PRODUCTION (cognidao.org)           → 84.32.109.162  (Cherry Servers, Docker Compose)
  www.cognidao.org                  → 84.32.109.162

CANARY (test.cognidao.org)          → 84.32.109.222  (Cherry Servers, k3s + Argo CD)
  poly-test.cognidao.org            → 84.32.109.222
  resy-test.cognidao.org            → 84.32.109.222

PREVIEW (preview.cognidao.org)      → 84.32.110.92   (Cherry Servers, k3s + Argo CD)
  poly-preview.cognidao.org         → 84.32.110.92
  resy-preview.cognidao.org         → 84.32.110.92
```

### Incident Log

| Date       | Impact                         | Root Cause                                                               | Resolution                                               |
| ---------- | ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| 2026-04-05 | All domains unreachable (~6hr) | cognidao.org expired (grace period). Namecheap suspended DNS resolution. | Renewed domain. DNS propagated in ~50 min after renewal. |

---

## Ranked Shortlist

Priority domains the team is actively considering. Ordered by preference.

| #   | Domain          | Annual Cost | Registrar         | Subdomain Example  | Notes                                                                                 |
| --- | --------------- | ----------- | ----------------- | ------------------ | ------------------------------------------------------------------------------------- |
| 1   | **cogni.gg**    | ~$52/yr     | Porkbun / Dynadot | `resy.cogni.gg`    | Gaming sector play. Each subdomain = a game group. Fun, memorable. Not on Cloudflare. |
| 2   | **cogni.build** | $25/yr      | Cloudflare        | `resy.cogni.build` | Builder identity. Perfect for open-source infra org.                                  |
| 3   | **cognidao.ai** | $70/yr      | Cloudflare        | `resy.cognidao.ai` | AI signal, full brand name. Premium but on-brand.                                     |
| 4   | **dao.run**     | $21/yr      | Cloudflare        | `resy.dao.run`     | Ultra-short, generic-ish. "DAO run" — action-oriented.                                |
| 5   | **oncog.io**    | $50/yr      | Cloudflare        | `resy.oncog.io`    | Short, techy. "On Cog" — like "on the network".                                       |
| 6   | **cogn.sh**     | $45/yr      | Cloudflare        | `resy.cogn.sh`     | Hacker aesthetic. Hard to say aloud though.                                           |

### Also Available — Honorable Mentions

| Domain           | Cost    | Registrar  | Why it's interesting                                  |
| ---------------- | ------- | ---------- | ----------------------------------------------------- |
| cogni.do         | ~$43/yr | Regery     | Reads as "cogni do" — action verb. Not on Cloudflare. |
| cogni.land       | $32/yr  | Cloudflare | Spatial metaphor. "Welcome to cogni land."            |
| cogni.foundation | $22/yr  | Cloudflare | Institutional/serious tone. Long subdomain though.    |
| cogni.community  | $35/yr  | Cloudflare | Explicit purpose. Very long.                          |
| cogdao.org       | $10/yr  | Cloudflare | Cheapest .org option. 2 chars shorter than cognidao.  |
| cogdao.io        | $50/yr  | Cloudflare | Tech standard.                                        |
| cogdao.ai        | $70/yr  | Cloudflare | AI + shorter than cognidao.                           |
| cogdao.co        | $26/yr  | Cloudflare | Modern, clean.                                        |
| cogdao.dev       | $10/yr  | Cloudflare | Dev-focused, cheap.                                   |
| cogdao.sh        | $45/yr  | Cloudflare | Hacker vibe.                                          |
| cogdao.app       | $12/yr  | Cloudflare | App-focused.                                          |
| cogdao.run       | $21/yr  | Cloudflare | Action-oriented.                                      |
| cogdao.gg        | ~$52/yr | Porkbun    | Community. Not on Cloudflare.                         |
| cogdao.build     | $25/yr  | Cloudflare | Builder + shorter brand.                              |
| cogdao.net       | $12/yr  | Cloudflare | Classic TLD.                                          |
| cognidao.io      | $50/yr  | Cloudflare | Current brand, better TLD.                            |
| cognidao.dev     | $10/yr  | Cloudflare | Dev signal, cheap.                                    |
| cognidao.co      | $26/yr  | Cloudflare | Modern.                                               |
| cognidao.sh      | $45/yr  | Cloudflare | Hacker.                                               |
| cognidao.app     | $12/yr  | Cloudflare | App.                                                  |
| cognidao.run     | $21/yr  | Cloudflare | Action.                                               |
| cognidao.gg      | ~$52/yr | Porkbun    | Community. Not on Cloudflare.                         |
| cognidao.build   | $25/yr  | Cloudflare | Builder.                                              |
| cognidao.land    | $32/yr  | Cloudflare | Spatial.                                              |
| cogn.run         | $21/yr  | Cloudflare | Short but hard to pronounce.                          |
| cogn.build       | $25/yr  | Cloudflare | Same issue.                                           |
| cogn.gg          | ~$52/yr | Porkbun    | Same.                                                 |
| cogn.land        | $32/yr  | Cloudflare | Same.                                                 |
| cogn.zone        | $30/yr  | Cloudflare | Same.                                                 |
| cogn.world       | $32/yr  | Cloudflare | Same.                                                 |
| cgn.sh           | $45/yr  | Cloudflare | Ultra-short abbreviation. Unpronounceable.            |
| cgn.dev          | $10/yr  | Cloudflare | Same.                                                 |
| cgn.run          | $21/yr  | Cloudflare | Same.                                                 |
| cgn.build        | $25/yr  | Cloudflare | Same.                                                 |
| cgn.land         | $32/yr  | Cloudflare | Same.                                                 |
| cgni.io          | $50/yr  | Cloudflare | Typo-bait.                                            |
| cgni.sh          | $45/yr  | Cloudflare | Same.                                                 |
| cgni.dev         | $10/yr  | Cloudflare | Same.                                                 |
| cogi.sh          | $45/yr  | Cloudflare | Phonetic variant.                                     |
| cogi.dev         | $10/yr  | Cloudflare | Same.                                                 |
| thecog.dev       | $10/yr  | Cloudflare | Readable but "the" prefix.                            |
| oncogni.com      | $10/yr  | Cloudflare | Rare .com availability.                               |
| cogniorg.com     | $10/yr  | Cloudflare | .com but redundant with .org.                         |
| cogniops.dev     | $10/yr  | Cloudflare | Ops-focused.                                          |
| cogninode.io     | $50/yr  | Cloudflare | Node-specific.                                        |
| nodecog.com      | $10/yr  | Cloudflare | .com, node-first branding.                            |

---

## Web3 Domains

One-time purchase, no renewal. Used for wallet resolution and Web3 identity.

### ENS (.eth) — Ethereum Name Service

| Domain         | Status    | Cost           | Notes                                                     |
| -------------- | --------- | -------------- | --------------------------------------------------------- |
| **cogdao.eth** | AVAILABLE | ~$5/yr + gas   | Best option — matches brand, cheap                        |
| **cogn.eth**   | AVAILABLE | ~$160/yr + gas | 4-char premium pricing                                    |
| cognidao.eth   | TAKEN     | —              | Already registered (0x983D...5812) — check if we own this |
| cogni.eth      | TAKEN     | —              | Registered                                                |
| cog.eth        | TAKEN     | —              | 3-char, registered                                        |
| dao.eth        | TAKEN     | —              | Registered, expires 2028-10                               |

Pricing: 5+ chars = ~$5/yr, 4 chars = ~$160/yr, 3 chars = ~$640/yr. Plus ETH gas (~$10-50).

Register at: [app.ens.domains](https://app.ens.domains)

### SNS (.sol) — Solana Name Service

| Domain           | Status    | Cost      | Notes                           |
| ---------------- | --------- | --------- | ------------------------------- |
| **cogni.sol**    | AVAILABLE | ~$20 once | Perfect match, one-time payment |
| **cogdao.sol**   | AVAILABLE | ~$20 once | Brand match                     |
| **cognidao.sol** | AVAILABLE | ~$20 once | Full brand                      |
| **cogn.sol**     | AVAILABLE | ~$20 once | Short                           |
| cog.sol          | TAKEN     | —         | Registered                      |
| dao.sol          | TAKEN     | —         | Registered                      |

Pricing: ~20 USDC one-time, no renewals. Plus ~0.001 SOL gas.

Register at: [sns.id](https://sns.id)

---

## TLD Price Reference

All prices annual. Cloudflare = wholesale (no markup).

| TLD         | Cloudflare/yr | On Cloudflare? | Cheapest Alt                  |
| ----------- | ------------- | -------------- | ----------------------------- |
| .com        | $10.44        | Yes            | —                             |
| .org        | $10.11        | Yes            | —                             |
| .net        | $11.84        | Yes            | —                             |
| .dev        | $10.18        | Yes            | —                             |
| .app        | $12.18        | Yes            | —                             |
| .xyz        | $11.18        | Yes            | —                             |
| .run        | $21.20        | Yes            | —                             |
| .foundation | $21.68        | Yes            | —                             |
| .build      | $25.18        | Yes            | —                             |
| .co         | $26.00        | Yes            | —                             |
| .zone       | $30.20        | Yes            | —                             |
| .land       | $32.20        | Yes            | —                             |
| .world      | $32.20        | Yes            | —                             |
| .community  | $35.20        | Yes            | —                             |
| .sh         | $45.00        | Yes            | —                             |
| .io         | $50.00        | Yes            | —                             |
| .gg         | —             | **No**         | ~$52 (Porkbun/Dynadot)        |
| .ai         | $70.00        | Yes            | —                             |
| .do         | —             | **No**         | ~$43 reg / $50 renew (Regery) |

---

## Ruled Out Bin

Domains checked and eliminated. Kept for reference so we don't re-check.

### All `cog.*` — every premium TLD is taken

cog.sh, cog.ai, cog.co, cog.io, cog.so, cog.do, cog.to, cog.cc, cog.is, cog.gg,
cog.run, cog.dev, cog.app, cog.build, cog.land, cog.zone, cog.world, cog.xyz,
cog.me, cog.network, cog.club, cog.org, cog.net

### All `dao.*` — completely taken (except dao.run, which is in shortlist)

dao.sh, dao.ai, dao.run, dao.dev, dao.build, dao.so, dao.to, dao.cc, dao.gg,
dao.is, dao.do, dao.co, dao.io, dao.app, dao.org, dao.land, dao.zone, dao.world,
dao.club, dao.network, dao.community

### `cogni.*` mainstream TLDs — taken

cogni.sh, cogni.io, cogni.ai, cogni.co, cogni.so, cogni.dev, cogni.app, cogni.run,
cogni.cc, cogni.is, cogni.org, cogni.net, cogni.us, cogni.xyz, cogni.me, cogni.zone,
cogni.world, cogni.network, cogni.systems, cogni.club, cogni.global

### Ultra-short but unpronounceable

cg.run, cg.sh, cn.sh, co.build — all taken anyway

### Taken compound domains

cogdao.com, cogdao.xyz, cogninode.com, oncog.com, getcog.com, getcogni.com,
usecogni.com, cogniops.com, cogniops.io, cgni.org, cgni.co, cogi.io, cogi.co,
cogi.ai, thecog.org, thecog.io

### Web3 — taken

cog.eth, dao.eth, cogni.eth, cognidao.eth, cog.sol, dao.sol

---

## Decision Log

| Date       | Decision                                      | Rationale                             |
| ---------- | --------------------------------------------- | ------------------------------------- |
| 2026-04-01 | Initial research complete                     | 150 domains checked across 6 batches  |
|            | cognidao.eth ownership check needed           | Address 0x983D...5812 — is this ours? |
|            | Top picks: cogni.gg, cogni.build, cognidao.ai | Pronounceability > brevity            |

## Projects

- (none yet — domain acquisition is pre-project)

## Next Steps

- [ ] Verify ownership of cognidao.eth (0x983D...5812)
- [ ] Price-check cogni.gg on Porkbun/Dynadot (may be premium priced)
- [ ] Decide primary domain vs. collection strategy (buy several, redirect?)
- [ ] Register cogdao.eth + cogni.sol as Web3 identity (cheap, no reason not to)
- [ ] Register chosen domain(s) on Cloudflare (or Porkbun for .gg)
- [ ] Update dns-ops package with new zone if domain changes
