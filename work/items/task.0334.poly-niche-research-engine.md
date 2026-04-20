---
id: task.0334
type: task
title: "Poly niche-research engine — skill-creator + research graph + Dolt store + EDO evidence"
status: needs_design
priority: 2
rank: 6
estimate: 5
created: 2026-04-20
updated: 2026-04-20
summary: "Three tracks in one feature: (1) a poly skill-creator that spawns specialized analyst graphs per Polymarket niche, (2) a structured niche-research LangGraph with a typed I/O contract writing Dolt rows that map niches → categories × candidate wallets × strategies × confidence, (3) an EDO (Event · Decision · Outcome) pipeline in Postgres that grounds every Dolt confidence score in replayable evidence."
outcome: "Anyone can point the engine at a niche (e.g. 'weather.city-high-temp', 'esports.lol-bo3'), get a Dolt-committed research row back within minutes, and see its confidence drift up or down as trades resolve and EDO replay lands outcome evidence. Wallet analyses from task.0333 reference niche rows; niche rows reference wallet analyses; outcomes ground both."
spec_refs:
  - docs/design/wallet-analysis-components.md
  - docs/spec/databases.md
  - docs/spec/knowledge-data-plane.md
assignees: []
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0333]
deploy_verified: false
labels:
  [poly, ai, langgraph, dolt, postgres, skill-creator, niche-research, edo]
---

# task.0334 — Poly Niche-Research Engine

## The three stores, mapped cleanly

```
 DOLT · authored, versioned, refinable              POSTGRES · append-only, replayable
 ────────────────────────────────────────────       ────────────────────────────────────
 poly_analyst_skills                                poly_edo_events
   skill_id (PK + schema_version)                     event_id  (ULID PK)
   niche                                              observed_at
   graph_spec_yaml                                    kind  — market_resolved | wallet_trade |
   tool_allowlist                                             niche_match | decision_emitted
   system_prompt_md                                   market_cid
   author · created_at · confidence                   wallet                (nullable)
                                                      niche_id              (nullable)
 poly_niche_research                                  decision_ref          (Dolt row ptr)
   niche_id                                           outcome_token         (nullable)
   author · created_at                                payload jsonb
   category_tags (jsonb)                              idx: (kind, market_cid, observed_at)
   strategy_md
   candidate_wallets jsonb — [{addr, rationale, p}]
   exclusion_rules jsonb
   confidence (calibrated)
   evidence_event_ids text[]  — refs into EDO
   credit_receipt_id
```

Dolt holds **claims + judgment**; Postgres holds **facts**. Confidence on Dolt rows is computed from the EDO evidence joined against the Dolt row's predictions.

## Three tracks, three checkpoints in one PR

### Track A — Structured research graph (I/O contract first)

- New LangGraph graph `poly-brain::niche-research` with an explicit, Zod-typed input + output, defined in `nodes/poly/app/src/contracts/graph/poly.niche-research.v1.contract.ts`:

  ```
  input  = { niche_id, depth: "shallow" | "standard" | "deep" }
  output = {
    category_tags: string[],
    strategy_md: string,
    candidate_wallets: Array<{ addr, rationale, p }>,
    exclusion_rules: Array<{ rule, reason }>,
    confidence: number,     // self-reported; calibrated later
    tools_called: string[], // for audit
  }
  ```

- Tools narrowed: `polymarket_market_search`, `polymarket_top_traders_by_category`, `polymarket_wallet_trades`, `polymarket_resolution`, `knowledge_search` (research doc corpus), and `poly_edo_query` (read-only over Postgres EDO table).
- Graph writes one `poly_niche_research` Dolt row per run. Dolt commit message names the run id and the skill_id it was run under.
- Idempotent on `(niche_id, input_sha)`: re-running with no new upstream data returns the existing row + zero credits (same policy as task.0333).

### Track B — Skill-creator (meta-graph that builds niche-specific analysts)

- `poly-brain::skill-creator` takes `{ niche_id, seed_research_row?, goal }` and emits a new `poly_analyst_skills` Dolt row containing:
  - `graph_spec_yaml` — declarative graph config (nodes + prompts) for a specialized analyst
  - `tool_allowlist` — narrowed subset of poly-brain tools relevant to the niche
  - `system_prompt_md` — structured scorecard template keyed to the niche

- At runtime, spawning `poly-brain::wallet-analyst@skill_id=<id>` loads the row and configures the analyst graph accordingly. This replaces the hard-coded `wallet-analyst:v1` skill in task.0333: once task.0334 ships, task.0333's agent loads its config from a Dolt `poly_analyst_skills` row instead of inline constants.
- Skills are versioned — new authorship writes a new row; consumers default to the latest commit on `main` branch; experiments branch and optionally merge.

### Track C — EDO (Event · Decision · Outcome) pipeline in Postgres

- Per-node migration `nodes/poly/packages/db-schema/migrations/0XXX_poly_edo_events.sql`:

  ```
  CREATE TABLE poly_edo_events (
    event_id       text PRIMARY KEY,        -- ULID
    observed_at    timestamptz NOT NULL,
    kind           text NOT NULL,           -- see event kinds below
    market_cid     text,
    wallet         text,
    niche_id       text,
    decision_ref   text,                    -- "dolt://<db>/<branch>/<row_id>"
    outcome_token  text,
    payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (kind IN ('market_resolved', 'wallet_trade', 'niche_match', 'decision_emitted'))
  );
  CREATE INDEX ... ON (kind, market_cid, observed_at);
  CREATE INDEX ... ON (wallet, observed_at) WHERE wallet IS NOT NULL;
  CREATE INDEX ... ON (niche_id, observed_at) WHERE niche_id IS NOT NULL;
  ```

- **Emitters** (wire existing sources):

  | kind               | emitter                                                                                            |
  | ------------------ | -------------------------------------------------------------------------------------------------- |
  | `wallet_trade`     | `poly.wallet_watch.fetch` → one row per seen trade                                                 |
  | `market_resolved`  | Resolution-poll worker (new; cheap — CLOB `/markets/{cid}` once, cache forever when `closed=true`) |
  | `niche_match`      | Niche-research graph emits at run-end                                                              |
  | `decision_emitted` | Analyst graph + copy-trade mirror emit decisions                                                   |

- **Calibration worker** — nightly batch (or on-resolution trigger):
  - Joins `decision_emitted` rows against `market_resolved` rows.
  - Computes Brier-delta, win-rate delta per `niche_id` and per candidate wallet.
  - Writes updated confidence onto the latest `poly_niche_research` Dolt row for each `niche_id` (new commit, preserves history — Dolt diff surfaces the update).

## Why split storage this way

| concern                              | Dolt                                | Postgres (EDO)             |
| ------------------------------------ | ----------------------------------- | -------------------------- |
| High-volume append-only facts        | ❌ commit overhead per row          | ✅ native                  |
| Versioned authored judgment          | ✅ commit = authorship              | ❌ blame lives elsewhere   |
| Point-in-time replay for calibration | ✅ (reachable via commits) but slow | ✅ index + timerange query |
| Diff two analyst versions            | ✅ `dolt diff` across branches      | ❌                         |
| Bulk joins across events             | ❌                                  | ✅                         |
| Branch a hypothesis then merge       | ✅                                  | ❌                         |

Mixing the two gets us authored judgment + bulk evidence without either layer doing the other's job badly.

## Validation

- [ ] `poly-brain::niche-research` graph runs against a test niche (`"weather.city-high-temp"`) end-to-end and returns a well-typed output matching the Zod contract.
- [ ] One new `poly_niche_research` Dolt row exists per run with a valid commit.
- [ ] Idempotent on `(niche_id, input_sha)`; zero-credit re-run returns existing row.
- [ ] `skill-creator` produces a `poly_analyst_skills` row; spawning `wallet-analyst@skill_id=…` loads it and runs.
- [ ] `poly_edo_events` table exists with the three indexes; emitter hooks wired into `poly.wallet_watch.fetch`, resolution poll, and both analyst + mirror graphs.
- [ ] Calibration worker, given a fixture of 100 decisions + 60 resolved markets, correctly computes Brier-delta and writes new Dolt commits with updated confidence on affected niche rows.
- [ ] EDO event query is exposed to agents as `poly_edo_query` tool (read-only, scoped filters) — not blanket table access.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs` clean.

## Open questions

1. **Event-kind vocabulary expansion.** Start with the four above; add `signal_emitted` and `copy_trade_placed` when callers need them. Keep the CHECK constraint updated.
2. **EDO retention.** All events forever, or rotate to cold storage after 90 days? v0 keeps everything; a separate compaction task lands if/when volume matters.
3. **Calibration cadence.** Nightly batch is fine for v0. Real-time requires streaming joins; not worth it until we're making live-money decisions.
4. **Skill-creator authorship.** v0 is user-triggered only. Autonomous skill-creation (agent decides it needs a new skill and spawns one) is scary enough to defer until calibration proves the first human-authored skills work.

## Out of Scope

- Paper-mirror harness driven by niche research (separate; belongs in `proj.poly-copy-trading`).
- Copy-trade CTA + Harvard-flagged gate (still vNext in task.0329).
- UI for browsing niche-research rows. v0 renders inside `WalletAnalysisView` via the niche-ref lookup; a dedicated `/research/niches` browse page is follow-up.
- Cross-niche ensemble models. One niche → one Dolt row for v0.
