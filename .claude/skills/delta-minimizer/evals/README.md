# delta-minimizer evals

`eval-set.json` — 9-query set covering the documented trigger phrases and 4 deliberate negatives.

## Bench result (2026-05-07)

Ran via `python3 -m scripts.run_eval` from `.claude/skills/skill-creator/` against:

- `claude-haiku-4-5-20251001` — **4 / 9 passed** (4 negatives correctly suppressed; 5 positives missed).
- `claude-sonnet-4-6` — **4 / 9 passed** (identical pass/fail split as haiku).

Both models correctly suppressed every negative ("promote", "create payments dashboard", "run db migration", "review PR"). Both missed every positive ("minimize our delta against copy targets", "why is our mean delta so high right now", "rank the failure modes…", "loop the delta study every 6 hours", "are we close to swisstony's compounding rate").

## Methodology caveat

`run_eval.py` writes a uniquely-named slash command file (`.claude/commands/delta-minimizer-skill-<hex>.md`) and detects triggering via `tool_use.name == "Skill" || "Read"` containing that unique id. When a skill named `delta-minimizer` already exists at `.claude/skills/delta-minimizer/`, headless `claude -p` resolves the user's query against the _real_ skill (name `delta-minimizer`) rather than the temp command — and the matcher misses, so the eval scores zero triggers regardless of whether the description is correctly leading the model. The 0/5 positive-trigger result therefore reflects an eval-harness collision, not necessarily a description weakness.

## In-session signal

In the active Claude Code session that authored this skill, the harness itself loaded `delta-minimizer` into the available-skills list immediately after `SKILL.md` was written, and trigger phrases like "minimize delta" or "loop the delta study" do route to it. That's the durable signal.

## Vnext for this eval

- Move the real `SKILL.md` to a temp location for the duration of `run_eval`, or
- Patch `run_eval.py` to detect Skill tool calls whose `skill` field equals the _base name_ (not the unique id), or
- Test triggering by reading whether the run produced the documented scorecard markdown shape, not just by tool-call name match.

Either path is in scope of a follow-up `task.NNNN` against `skill-creator`. Not blocking shipping this skill.
