---
id: task.5069.handoff
type: handoff
title: "DoltHub push hook handoff (task.5069 + PR #1360)"
related_task: task.5069
related_pr: 1360
related_project: proj.knowledge-write-pipeline
related_knowledge: dolt-remote-v0
status: in_progress
created: 2026-05-28
owner: derekg1729
---

# DoltHub push hook — handoff to successor agent

## What you're picking up

PR #1360 is open on `derekg1729/dolthub-env-wiring`. It plumbs `DOLTHUB_OAUTH_CLIENT_ID` + `DOLTHUB_OAUTH_CLIENT_SECRET` through every surface (Zod schema, compose dev/prod, deploy-infra.sh ×4 places, two GitHub workflows, SETUP_DESIGN.md, .env.operator.example). No runtime consumer yet — pure plumbing.

Task **task.5069** is the substantive follow-up: build the push hook + OAuth callback endpoint + provisioning, gated by `DOLT_REMOTE_PUSH_ENABLED=true` on prod. Wire it on top of #1360 once that merges.

Decision context lives in two places:

- Knowledge entry `dolt-remote-v0` (filed as contribution `contrib-derek-claude-curitiba-81daec98`, awaiting merge on cognidao.org/knowledge?mode=inbox) — convention + topology summary
- `proj.knowledge-write-pipeline.md` — phased roadmap; the push hook is the v0b/v1 work

## Hard constraints you must honor

| Invariant                                              | Where it lives                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Polyrepo on DoltHub, never monorepo                    | `dolt-remote-v0` knowledge entry; one DoltHub repo per node hub |
| Repo name = `knowledge-<node>` (kebab)                 | matches Doltgres DB `knowledge_<node>` (underscore→hyphen)      |
| One operator-owned OAuth app pushes for all nodes      | not per-node OAuth apps; per-fork is out of scope               |
| Direction v0: prod → DoltHub → others pull             | no test→prod merges; bidirectional is v1+                       |
| Push is best-effort, never raises `KnowledgeGateError` | local write succeeds even when push fails; log the error        |
| `DOLT_REMOTE_PUSH_ENABLED=true` only on prod           | dev/test/candidate-a default to local-only                      |

## Open questions you'll have to answer

1. **Token storage**: AEAD-encrypted in a Postgres table (`dolthub_oauth_tokens`) following the Privy wallets pattern? Or k8s secret + sealed-secret? Lean: Postgres + AEAD for consistency with existing token-handling code; lookup the Privy/CLOB AEAD pattern in `nodes/poly/...` (search `POLY_WALLET_AEAD_KEY_HEX`).
2. **Refresh-token flow**: DoltHub OAuth access tokens — TTL? Do we need to schedule a refresh? Check `https://docs.dolthub.com/dolthub/api/oauth`. Probably need a refresh-token-aware client.
3. **Push timing**: synchronous in the capability `write()` (adds latency) or fire-and-forget after `port.commit()`? Lean: fire-and-forget with structured logging; latency matters for the agent recall loop.
4. **What does "remote initialized" look like on a brand-new Doltgres database?** The `provision.sh` change adds `CALL DOLT_REMOTE('add', 'origin', …)` after `CREATE DATABASE`. Confirm Doltgres 0.56+ supports this; test on a fresh `knowledge_<node>` db.

## Known blocker — Derek must unblock

**The OAuth flow requires browser interaction.** As the agent I tried to test the key and could not:

- `DOLTHUB_OAUTH_CLIENT_ID` is NOT in `/Users/derek/dev/cogni-template/.env.operator` (only the SECRET was added)
- DoltHub uses authorization_code grant only — `client_credentials` returns HTML, not a token
- A working callback endpoint doesn't exist yet (this task ships it)

Before successor can validate the push hook end-to-end on candidate-a, Derek must either:

- (a) Add `DOLTHUB_OAUTH_CLIENT_ID` to `.env.operator`, complete OAuth flow once the callback endpoint deploys, and the access token gets stored automatically, OR
- (b) Generate a DoltHub Personal Access Token (PAT) at https://www.dolthub.com → Settings → Tokens and provide it via a different env var (`DOLTHUB_API_TOKEN`) — bypasses the OAuth dance entirely for v0. **Recommend this path** for simpler v0 — keep OAuth wiring for v1 (per-user DoltHub identity for the librarian).

Either way, the GitHub Environment Secrets for both vars must be set in candidate-a/preview/production scopes (see DoltHub PR #1360 description for `gh secret set` commands).

## What "done" looks like

1. `/api/v1/dolt/oauth/callback?code=…` exchanges + stores token. Audit log entry written.
2. `core__knowledge_write` on prod creates a Doltgres row, captures the commit, **and** pushes to `https://www.dolthub.com/cogni-dao/knowledge-operator` within ~5s. Visible in the DoltHub UI.
3. Disable `DOLT_REMOTE_PUSH_ENABLED` → writes succeed locally with no push attempt. Re-enable → resumes.
4. candidate-flight green; `/validate-candidate` proves the push path with a fresh probe entry.

## Files to read first (in order)

1. `work/projects/proj.knowledge-write-pipeline.md` — roadmap context
2. `.claude/skills/knowledge-syntropy-expert/SKILL.md` — action hierarchy + invariants
3. `docs/spec/knowledge-data-plane.md` — Sharing+Federation section (will be edited in this task)
4. `packages/knowledge-store/src/capability.ts` — capability layer to extend
5. `packages/knowledge-store/src/adapters/doltgres/knowledge-store-adapter.ts` — adapter to extend with `pushToRemote`
6. PR #1360 diff — see exactly what env wiring landed

## File pointers (where new code goes)

- `packages/knowledge-store/src/port/knowledge-store.port.ts` — add `pushToRemote` to the interface
- `packages/knowledge-store/src/adapters/doltgres/knowledge-store-adapter.ts` — implement via `sql.unsafe + escapeValue`
- `packages/knowledge-store/src/capability.ts` — call `port.pushToRemote('origin','main').catch(log)` after `port.commit()`
- `nodes/operator/app/src/app/api/v1/dolt/oauth/callback/route.ts` — new admin-only callback handler
- `nodes/operator/app/src/bootstrap/container.ts` — wire push-enabled flag from env
- `infra/compose/runtime/doltgres-init/provision.sh` — add `CALL DOLT_REMOTE('add','origin',…)` post-CREATE DATABASE
- `docs/spec/knowledge-data-plane.md` — refine Sharing+Federation + add 2 new invariants
- `work/charters/KNOWLEDGE.md` — flip "Dolt remotes" ask from 🔴 to 🟡 when this PR lands

## Anti-patterns specific to this task

- **Don't push from candidate-a/test/preview.** They pull from DoltHub. Pushing from multiple envs creates merge surprises.
- **Don't surface push errors as `KnowledgeGateError`.** Push is best-effort; the gate chain already decided to accept the write.
- **Don't add a new gate for the push path.** Push happens AFTER `port.commit()`. Gates apply at the write boundary, not the replication seam.
- **Don't make this a per-node OAuth app.** One operator app for all nodes is the architectural decision.

## Status as of this handoff

- PR #1360: pushed at `d49656c03`, CI running, env-wiring only, no runtime consumer
- task.5069: filed, status `needs_triage`
- Knowledge entry `dolt-remote-v0`: contribution staged on prod, awaiting merge
- Derek-side blockers: add `DOLTHUB_OAUTH_CLIENT_ID` to `.env.operator`; create the 6 GitHub Environment Secrets (2 vars × 3 envs); decide PAT-vs-OAuth path for v0

## Successor checklist

- [ ] Merge or wait for #1360
- [ ] Decide PAT vs OAuth-callback for v0 (recommend PAT)
- [ ] Implement `KnowledgeStorePort.pushToRemote` + adapter
- [ ] Wire capability post-commit push
- [ ] Refine `knowledge-data-plane.md` § Sharing+Federation
- [ ] Flight to candidate-a
- [ ] `/validate-candidate` with a real DoltHub push probe
- [ ] Update charter scorecard: Dolt remotes 🔴 → 🟡
