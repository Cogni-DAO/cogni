---
description: "Write a context handoff for a new developer"
user-invocable: true
---

It's time to hand this project off to a new developer. Assume they have no context of the task you've been working on, but avoid over-prescribing implementation details. Focus on the goals, functional requirements, and pointers to documentation + important files + functions.

Write a handoff to `work/handoffs/{workItemId}.handoff.md` following the contract in `work/README.md#Handoffs` and the template at `work/_templates/handoff.md`.

Rules:

- Max 200 lines, 6 sections, no pasted logs/transcripts
- Link to files/commits instead of copying code blocks > 60 lines
- Frontmatter must include work_item_id, status, branch, last_commit
- If a handoff already exists, archive the old one to `work/handoffs/archive/{workItemId}/{datetime}.md` first (datetime format: YYYY-MM-DDTHH-MM-SS)
- After writing the handoff, append a link to the work item's `## PR / Links` section: `- Handoff: [handoff](../handoffs/{workItemId}.handoff.md)`
