# images · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Infra-owned Docker image build contexts. These produce images used by Compose services
or deployed to GHCR for k8s consumption.

## Contents

- `litellm/` — LiteLLM proxy with custom CogniNodeRouter billing callback
- `sandbox-proxy/` — nginx gateway config templates for OpenClaw LLM proxy

## Boundaries

```json
{
  "layer": "infra",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Change Protocol

- Adding a new infra image: create `images/{name}/` with Dockerfile
