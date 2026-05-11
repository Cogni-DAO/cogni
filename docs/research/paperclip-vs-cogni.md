---
id: paperclip-vs-cogni
type: research
title: "Paperclip OSS vs Cogni Node Template — Company-Stack Comparison"
status: draft
trust: draft
summary: "1-minute visual comparison: Paperclip is a single-operator 'team dashboard' marketed as a zero-human company. OpenClaw is one personal-assistant agent. Cogni is a DAO-governed, wallet-custodied, forkable company foundation. The 'company vs agent' meme is half-true; the harder truth is that Paperclip has no second stakeholder, no wallet, no exit, and no production users — Cogni's differentiator sits exactly in those gaps."
read_when: "Positioning Cogni against the 2026 'AI company OS' wave, deciding what to borrow from Paperclip, briefing investors/users on why DAO ≠ Paperclip-with-crypto."
owner: derekg1729
created: 2026-05-11
tags: [paperclip, openclaw, positioning, dao, research]
---

# Paperclip vs OpenClaw vs Cogni — at a glance

> spike: paperclip-cogni-comparison · date: 2026-05-11
> **TL;DR** — Paperclip = **single-user team dashboard** (org-chart-as-UI, no wallet, no second stakeholder, zero docu­mented prod users). OpenClaw = **one daemonized agent** (12+ chat surfaces). Cogni = **multi-stakeholder DAO foundation** (wallet custody, on-chain governance, fork = new company). The meme is _half_ right.

---

## 30-second scan

| Project        | What it actually is                                                      | License                     | Stars (May 2026) | Age   | Production users    |
| -------------- | ------------------------------------------------------------------------ | --------------------------- | ---------------- | ----- | ------------------- |
| **Paperclip**  | Node.js+React **CEO dashboard** for orchestrating BYO agents             | MIT                         | 53k+             | 2 mo  | **0 documented** ¹  |
| **OpenClaw**   | Local daemon bridging an LLM to 12+ messaging apps                       | MIT                         | 250k+            | 6 mo  | Many personal users |
| **Cogni Node** | Forkable DAO+app: wallet, on-chain gov, eval gates, multi-tenant gateway | Polyform Shield (open-core) | (template)       | 18 mo | poly node (real $)  |

¹ "No documented examples of companies actually running on Paperclip alone" — [SOTAAZ analysis](https://www.sotaaz.com/post/paperclip-zero-human-company-en). Roadmap explicitly still includes "multiple human users support."

---

## Layer map

```
┌────────────────────────────────────────────────────────────────┐
│  DAO / TREASURY / WALLET CUSTODY / ON-CHAIN GOVERNANCE         │
│  ────────────────────────────────────────────────────────────  │
│  ◆ Cogni only          (Aragon OSx + $SNAP + epoch_allocations) │
├────────────────────────────────────────────────────────────────┤
│  COMPANY  — org chart, roles, budgets, board approval, audit   │
│  ────────────────────────────────────────────────────────────  │
│  ◆ Paperclip ★         (today: single human "CEO")              │
│  ◆ Cogni  (proj.operator-plane, governance-agents, work-items)  │
├────────────────────────────────────────────────────────────────┤
│  AGENT RUNTIME / EMPLOYEE  — persistent loop, tools, budget    │
│  ────────────────────────────────────────────────────────────  │
│  ◆ OpenClaw ★          ◆ Claude Code   ◆ Codex   ◆ LangGraph    │
├────────────────────────────────────────────────────────────────┤
│  CHAT SURFACE / IDE  — where humans talk to agents             │
│  ────────────────────────────────────────────────────────────  │
│  ◆ OpenClaw    ◆ Slack/Discord/iMessage    ◆ Cursor/VS Code     │
└────────────────────────────────────────────────────────────────┘
```

★ = primary home. Cogni spans all three but is **the only one above the line**.

---

## Identity model — side-by-side

|                        | Paperclip                                                            | Cogni                                                                                                |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Per-agent identity** | 4 markdown files: `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md` | `actor_id` UUID + `actor_bindings` (wallet, OAuth, GitHub)                                           |
| **Per-org identity**   | Implicit — one Paperclip deploy = one org                            | 6 orthogonal keys: `node_id`, `scope_id`, `dao_address`, `billing_account_id`, `user_id`, `actor_id` |
| **Stakeholders**       | 1 human operator (multi-human on roadmap)                            | N humans + N agents, on-chain token holders                                                          |
| **Source of truth**    | Embedded Postgres + markdown files                                   | Per-node Postgres + `.cogni/repo-spec.yaml` (git) + on-chain DAO                                     |
| **Custody**            | Operator's machine                                                   | Node owns DAO keys; **operator never touches them**                                                  |
| **Exit / fork**        | Copy the DB, lose the org                                            | Fork the repo, get a _new sovereign company_                                                         |

→ [Identity Model spec](../spec/identity-model.md) · [Node vs Operator Contract](../spec/node-operator-contract.md)

---

## Feature matrix — what each actually ships

| Capability                           |     Paperclip     |  OpenClaw   |                                          Cogni Node                                           |
| ------------------------------------ | :---------------: | :---------: | :-------------------------------------------------------------------------------------------: |
| Org chart / reporting                |        ✅         |     ❌      | 🟡 work-items + scopes ([agentic-PM](../../work/projects/proj.agentic-project-management.md)) |
| Heartbeat scheduler                  | ✅ 4/8/12hr fixed |     ✅      |                      ✅ Temporal (event + scheduled, arbitrary cadence)                       |
| Per-agent budget                     |  ✅ 80%/100%/CB   |     ❌      |                          ✅ `budget_allocations` + parent delegation                          |
| Atomic task checkout                 |        ✅         |     ❌      |                            ✅ work-item lock + status transitions                             |
| BYO agent (Claude Code, Codex, etc.) |        ✅         |     n/a     |                            ✅ proj.agent-registry (multi-adapter)                             |
| Chat-app inbox                       |        ❌         |   ✅ 12+    |            🟡 [messenger-channels](../../work/projects/proj.messenger-channels.md)            |
| Self-hosted, no SaaS account         |        ✅         |     ✅      |                                              ✅                                               |
| **Eval-gated AI releases**           |        ❌         |     ❌      |                                      ✅ Langfuse CI gate                                      |
| **DAO + on-chain governance**        |        ❌         |     ❌      |                                         ✅ Aragon OSx                                         |
| **Treasury / wallet custody**        |        ❌         |     ❌      |                                  ✅ non-negotiable invariant                                  |
| **Multi-human stakeholders**         |   ❌ (roadmap)    |     ❌      |                                ✅ token holders + actor model                                 |
| **Forkable sovereign template**      |   ❌ one deploy   |     ❌      |                                     ✅ fork = new company                                     |
| **Earned rewards (not just spend)**  |        ❌         |     ❌      |                                 ✅ epoch_allocations → $SNAP                                  |
| **USDC-funded LLM gateway**          |        ❌         |     ❌      |                               ✅ OpenAI-compatible passthrough                                |
| **Production track record**          | ❌ "aspirational" | ✅ personal |                                🟡 poly node trading real USDC                                 |

---

## Verdict on the "company vs agent" meme

> "Paperclip is like a company. OpenClaw is like an agent."

**Half-true.**

- **OpenClaw = agent**: accurate. It's one persistent loop bridged to messaging surfaces.
- **Paperclip = company**: _metaphor, not substance_. There is **one human operator** (today), no second stakeholder, no legal entity, no equity, no exit, no on-chain treasury, no externally-claimable provenance. It is a **single-tenant CEO dashboard** dressed in company vocabulary. Roadmap _plans_ "multiple humans" — i.e., they admit it.

**Cogni's claim is a strict superset** of what Paperclip ships, plus the three things Paperclip explicitly lacks:

| Cogni adds                       | Why it matters                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **On-chain DAO** (Aragon OSx)    | Two or more stakeholders with enforceable votes. Paperclip's "board approval" is one user clicking.  |
| **Wallet custody invariant**     | Node owns treasury keys. Multi-party economic accountability. Operator services never touch them.    |
| **Fork = new sovereign company** | Paperclip is _one_ installation per org. Cogni is an **org factory** — each fork is its own DAO+app. |

→ [CogniDAO Charter](../../work/charters/CHARTER.md) · [Node vs Operator Contract](../spec/node-operator-contract.md)

---

## What Paperclip is **not** (the critical part)

1. **Not multi-party.** Single human controls all hires/budgets/strategy. No way to split ownership or veto power among co-founders without forking the codebase.
2. **Not on-chain.** No wallet, no token, no smart contract, no claimable rewards. "Budget" is a row in their pg DB.
3. **Not production-proven.** "No documented examples of companies actually running on Paperclip alone exist yet." 53k stars ≠ 53k companies.
4. **Not durable.** Pseudonymous founder (`@dotta`), no disclosed company/funding, 2 months old. Bus factor unknown.
5. **Not portable.** Org lives in one Paperclip install's embedded Postgres + filesystem. Migration story = `pg_dump`.
6. **Not interoperable as a substrate.** Other systems can't _consume_ a Paperclip org as an authoritative source — there's no spec, no signed manifest, no on-chain anchor. Compare: Cogni's `.cogni/repo-spec.yaml` is git-versioned, hashable, consumable by operator services.
7. **Not new tech.** Heartbeat + budget + audit + org chart are GUI on top of standard primitives. The novelty is the _metaphor_, not the substrate.

→ Source: [SOTAAZ](https://www.sotaaz.com/post/paperclip-zero-human-company-en), [Ry Walker analysis](https://rywalker.com/research/paperclip)

---

## What Cogni is **not** (steelman the other side)

1. **Not friction-free.** DAO formation, repo-spec, wallet, RLS, Polyform license — none of this is necessary for a solo founder running 5 agents to clean their inbox. Paperclip wins that user.
2. **Not zero-config.** Cogni demands chain_id, wallet, USDC, Aragon. Paperclip is `pnpm install` → CEO dashboard.
3. **Not viral.** 53k stars > 100% of Cogni's mindshare. Cogni is a template; Paperclip is a product narrative.
4. **Not template-ready for "company" UX yet.** The vocabulary ("hire", "org chart", "budget") that makes Paperclip click is absent from our operator UI today.
5. **Not OSS-license-friendly.** Polyform Shield restricts commercial use. Paperclip is MIT — strictly more open.

---

## Strategic risk / opportunity

```
              Risk                                  Opportunity
              ────                                  ───────────
  Paperclip's framing captures the AI-     │   Paperclip + Cogni compose:
  company mindshare without crypto tax.    │   Paperclip = internal ops UX
  If they ship "multi-human + cloud"       │   Cogni    = treasury, gov, identity
  (already on roadmap), they converge      │
  toward our market without our cost.      │   Publish: "Graduate your Paperclip
                                           │   org to a Cogni DAO" — import
  53k stars vs Cogni's mindshare = real    │   org-chart YAML → actors + scopes.
  distribution risk. Their "human control
  plane" tagline is *anti-DAO*; we should
  not concede the "AI company" label.
```

---

## Concrete overlap with Cogni's roadmap

| Cogni project                                                                             | Paperclip analog                    | Action                                           |
| ----------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| [proj.operator-plane](../../work/projects/proj.operator-plane.md) (v1 budgets)            | per-agent budget + spawn            | Borrow UX vocabulary; keep actor-model substrate |
| [proj.agentic-project-management](../../work/projects/proj.agentic-project-management.md) | tickets, org chart, audit           | Borrow data model; map to `WorkItemPort`         |
| [proj.governance-agents](../../work/projects/proj.governance-agents.md)                   | board-approval workflows            | Cogni's is incident-gated + Temporal-driven      |
| [proj.agent-registry](../../work/projects/proj.agent-registry.md)                         | "hire an agent" catalog             | Already multi-adapter (broader than Paperclip)   |
| [proj.openclaw-capabilities](../../work/projects/proj.openclaw-capabilities.md)           | (OpenClaw _is_ an employee runtime) | Already integrating                              |
| [proj.messenger-channels](../../work/projects/proj.messenger-channels.md)                 | (OpenClaw _is_ the channel bridge)  | Already integrating                              |
| [proj.maximize-oss-tools](../../work/projects/proj.maximize-oss-tools.md)                 | (Paperclip itself as candidate)     | Evaluate Paperclip-org → Cogni-actors import     |

---

## Recommendation

1. **Adopt Paperclip's vocabulary, keep our substrate.** "Hire an agent", "org chart", "budget", "board approval" — these are the words that make non-DAO users _get it_. Cogni already has the backing primitives (`actors`, `budget_allocations`, `scope_id`, governance workflows). What's missing is the UI layer that talks like Paperclip.
2. **Do not pivot to Paperclip's architecture.** Wallet custody, on-chain governance, fork-as-company — these are exactly the gaps Paperclip can't paper over. They are _the_ differentiator. Holding the line means: do not relax `WALLET_CUSTODY`, do not weaken repo-spec authority, do not lose `FORK_FREEDOM`.
3. **Ship a Paperclip-compatible import.** Map their `AGENTS.md` + org-chart YAML → Cogni `actors` + `scope` + `budget_allocations`. Cheap interop; lets Paperclip's 53k-star audience graduate to a DAO without rewriting.
4. **Reclaim "AI company" framing.** Paperclip's tagline ("human control plane for AI labor") is anti-DAO by construction — it assumes one human at the top. Our message: a _real_ AI company has multiple stakeholders, a treasury, an exit. That's a DAO. That's Cogni.
5. **Do not chase OpenClaw's star count.** OpenClaw is one runtime among many in [proj.agent-registry](../../work/projects/proj.agent-registry.md). Don't compete on personal-assistant UX; we already integrate.

---

## Open questions

- Does Paperclip's `AGENTS.md` schema overlap with Cogni's existing `AGENTS.md` convention (per [agents.md spec](https://agents.md/))? If yes, we may already be partially Paperclip-compatible.
- Is the `4/8/12hr heartbeat` cadence sufficient for Cogni's governance flow, or does Temporal's event-driven model strictly dominate? (Probably the latter for incident-gated work; the former might be fine for routine "company" ops.)
- Could Cogni's `actor_id` + `actor_bindings` _be_ the Paperclip employee record under different naming? If yes, an import is 1-2 days of work.
- Is there a meaningful Paperclip user segment (solo SMB operators) that would buy a Cogni node _if_ we hid the crypto behind a one-click DAO formation? (See [proj.node-formation-ui](../../work/projects/proj.node-formation-ui.md).)

---

## Proposed Layout

**Project**: no new `proj.*` warranted today. Positioning, not new build.

**Specs** (small follow-ups):

- [`docs/spec/node-operator-contract.md`](../spec/node-operator-contract.md) — add a "Related OSS landscape" pointer to this doc.
- [`ROADMAP.md`](../../ROADMAP.md) — one-line: operator dashboard UX takes vocabulary cues from Paperclip's company metaphor.

**Tasks** (lean, optional):

- `task.*` — rename operator dashboard primitives to use "hire / org chart / budget / approve" vocabulary (1 PR, UI-only).
- `spike.*` — evaluate Paperclip's `AGENTS.md` + org-chart YAML for round-trip import into Cogni `actors` + `scopes` (1 day, doc-only).
- `story.*` — "Graduate your Paperclip company to a Cogni DAO" — landing page + import flow (gated on the spike).

---

## Further reading

**Paperclip**

- [GitHub repo](https://github.com/paperclipai/paperclip) · [Product site](https://paperclip.ing/)
- [StartupHub interview with the founder](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/paperclip-ceo-on-building-zero-human-companies)
- [Jimmy Song write-up](https://jimmysong.io/ai/paperclip/) · [Ry Walker — critical analysis](https://rywalker.com/research/paperclip)
- [MindStudio explainer](https://www.mindstudio.ai/blog/what-is-paperclip-zero-human-ai-company-framework) · [SOTAAZ technical deep-dive](https://www.sotaaz.com/post/paperclip-zero-human-company-en)
- [Medium — Kris Dunham](https://medium.com/@creativeaininja/paperclip-the-open-source-platform-turning-ai-agents-into-an-actual-company-7348015c5bf7)

**OpenClaw**

- [GitHub repo](https://github.com/openclaw/openclaw) · [Docs](https://docs.openclaw.ai/)
- [NVIDIA dev blog — local AI agent](https://developer.nvidia.com/blog/build-a-secure-always-on-local-ai-agent-with-nvidia-nemoclaw-and-openclaw/)
- [DigitalOcean explainer](https://www.digitalocean.com/resources/articles/what-is-openclaw)

**Cogni**

- [ROADMAP](../../ROADMAP.md) · [Charter](../../work/charters/CHARTER.md) · [Node vs Operator Contract](../spec/node-operator-contract.md) · [Identity Model](../spec/identity-model.md)
- [proj.operator-plane](../../work/projects/proj.operator-plane.md) — multi-tenant gateway + actor model
- [proj.agentic-project-management](../../work/projects/proj.agentic-project-management.md) — work-items / org structure
- [proj.openclaw-capabilities](../../work/projects/proj.openclaw-capabilities.md) — OpenClaw integration
- [Agentic Internet Gap Analysis](agentic-internet-gap-analysis.md) — broader landscape
