---
description: "Sync agent custom commands across all agent directories"
user-invocable: true
---

Your task is to ensure that these directories are exactly in sync with one another in terms of the contents of the custom instructions/prompts/workflows that exist in the agent directories:

- `.agent/`
- `.claude/`
- `.clinerules/`
- `.cursor/`
- `.gemini/`
- `.github/`
- `.openclaw/`

See "git status" for the most recently updated agent custom command that has been edited. This is the ONLY change you must propagate. This might originate in any of the above directories, and your job is to propagate this change verbatim to all other agent directories. Identify the exact change, and now propagate this, verbatim, to all other agent instruction directories.

Note that each agent directory may have unique path/naming/formatting conventions. Identify them by seeing the examples that already exist in the directories, and then adhere to these conventions as you propagate the change.

Now ensure the new update reaches each of the agent directories.
