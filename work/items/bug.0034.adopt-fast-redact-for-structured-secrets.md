---
id: bug.0034
type: bug
title: "Secrets redaction uses regex on serialized JSON — adopt fast-redact for structured fields"
status: needs_triage
priority: 3
estimate: 2
summary: "Current secrets-redaction.ts applies regex patterns to JSON.stringify'd tool args/results. This is fragile — it can corrupt JSON structure, miss nested secrets, or false-positive on non-secret content. Adopt fast-redact (path-based redaction) for structured tool-call args, results, and metadata."
outcome: "Tool-call args/results and thread metadata redacted via fast-redact with an allowlist of sensitive paths (authorization, token, secret, password, apiKey). Regex patterns retained only for free-text parts. No false positives on structured data."
spec_refs: thread-persistence
assignees:
  - unassigned
credit:
project:
branch:
pr:
created: 2026-02-11
updated: 2026-02-11
revision: 0
blocked_by:
deploy_verified: false
rank: 7
---

# Adopt fast-redact for structured secrets redaction

## Problem

`src/features/ai/services/secrets-redaction.ts` applies regex to `JSON.stringify(part.input)` and `JSON.stringify(part.output)` for tool-call parts. This approach:

1. Can corrupt JSON if regex matches across key/value boundaries
2. Misses deeply nested secrets that don't match surface patterns
3. False-positives on non-secret strings that look like tokens

## Solution

- Add `fast-redact` dependency (<https://github.com/davidmarkclements/fast-redact>)
- Define an allowlist of redaction paths: `['authorization', 'token', 'secret', 'password', 'apiKey', 'api_key', 'access_token', 'refresh_token']`
- Apply path-based redaction to tool-call `input`/`output` objects and thread `metadata`
- Keep regex patterns only for free-text `TextUIPart.text` content
- Optional follow-up: Microsoft Presidio for PII anonymization as a separate projection (not canonical transcript mutation)

## Validation

- [ ] Tool-call args with `authorization`/`token`/`password` keys are redacted via fast-redact paths
- [ ] Free-text regex patterns still catch API keys and JWTs in text parts
- [ ] No JSON corruption from regex applied to structured data
- [ ] Existing secrets-redaction unit tests updated and passing

## References

- Decision doc: secrets-redaction policy (2026-02-11)
- Current impl: `src/features/ai/services/secrets-redaction.ts`
