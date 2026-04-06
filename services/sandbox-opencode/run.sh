#!/bin/bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# OpenCode Coding Agent Runner
# Reads COGNI_MODEL from graph executor, runs OpenCode against LiteLLM proxy.
# Output: SandboxProgramContract JSON envelope on stdout.

set -euo pipefail

START_MS=$(($(date +%s%N) / 1000000))

# Helper: emit SandboxProgramContract envelope and exit
emit() {
    local text="${1:-}"
    local error_code="${2:-}"
    local error_msg="${3:-}"
    local end_ms=$(($(date +%s%N) / 1000000))
    local duration_ms=$((end_ms - START_MS))

    if [[ -n "$error_code" ]]; then
        printf '{"payloads":[{"text":"%s"}],"meta":{"durationMs":%d,"error":{"code":"%s","message":"%s"}}}' \
            "$(echo "$text" | jq -Rs '.' | sed 's/^"//;s/"$//')" \
            "$duration_ms" \
            "$error_code" \
            "$(echo "$error_msg" | jq -Rs '.' | sed 's/^"//;s/"$//')"
    else
        printf '{"payloads":[{"text":"%s"}],"meta":{"durationMs":%d,"error":null}}' \
            "$(echo "$text" | jq -Rs '.' | sed 's/^"//;s/"$//')" \
            "$duration_ms"
    fi
    [[ -n "$error_code" ]] && exit 1 || exit 0
}

MODEL="${COGNI_MODEL:?COGNI_MODEL env var required}"
API_BASE="${OPENAI_API_BASE:-http://localhost:8080}"

# ── Read task context (C7: standard protocol path) ──────────────────────────
if [[ -f /workspace/.cogni/context.json ]]; then
    # Structured context (work item resolved by host via WorkItemPort)
    TASK_MSG="$(jq -r '.task // .messages[-1].content // empty' /workspace/.cogni/context.json)"
elif [[ -f /workspace/.cogni/messages.json ]]; then
    # Standard sandbox protocol — extract last user message
    TASK_MSG="$(jq -r '[.[] | select(.role=="user")] | last | .content // empty' /workspace/.cogni/messages.json)"
else
    emit "" "input_error" "No task input. Host must write /workspace/.cogni/context.json or messages.json"
fi

if [[ -z "$TASK_MSG" ]]; then
    emit "" "input_error" "Task message resolved to empty string"
fi

# Git identity
git config --global user.email "cogni-opencode@cognidao.org"
git config --global user.name "Cogni OpenCode Agent"
git config --global init.defaultBranch main

# Init git if needed
if [[ ! -d /workspace/.git ]]; then
    git init /workspace
    git -C /workspace add -A 2>/dev/null || true
    git -C /workspace commit -m "initial" --allow-empty 2>/dev/null || true
fi

BEFORE_SHA="$(git -C /workspace rev-parse HEAD 2>/dev/null || echo 'none')"

# B2: OpenCode model config via LOCAL_ENDPOINT + opencode.json
# OpenCode reads LOCAL_ENDPOINT to discover an OpenAI-compatible API.
# The opencode.json sets the model for the coder agent since -m flag
# doesn't work with -p mode.
export LOCAL_ENDPOINT="$API_BASE"
# sk-not-a-real-key: LiteLLM proxy strips this — real auth is injected by nginx sidecar
export OPENAI_API_KEY="${LITELLM_API_KEY:-sk-not-a-real-key}"

# Generate opencode.json dynamically (config doesn't support env var substitution)
# Use local. prefix since LOCAL_ENDPOINT models are registered as local.<model_id>
cat > /workspace/opencode.json <<OCFG
{
  "agents": {
    "coder": { "model": "local.${MODEL}" },
    "summarizer": { "model": "local.${MODEL}" },
    "task": { "model": "local.${MODEL}" },
    "title": { "model": "local.${MODEL}" }
  }
}
OCFG

# C5: Capture stderr instead of swallowing it
OPENCODE_STDERR="$(mktemp)"
opencode -p "$TASK_MSG" 2>"$OPENCODE_STDERR" || {
    OC_ERR="$(cat "$OPENCODE_STDERR")"
    rm -f "$OPENCODE_STDERR"
    emit "" "agent_error" "OpenCode failed: $OC_ERR"
}
rm -f "$OPENCODE_STDERR"

AFTER_SHA="$(git -C /workspace rev-parse HEAD 2>/dev/null || echo 'none')"

# Build result summary text
if [[ "$BEFORE_SHA" == "$AFTER_SHA" ]]; then
    SUMMARY="No files changed."
else
    FILES="$(git -C /workspace diff --name-only "$BEFORE_SHA".."$AFTER_SHA" | head -50)"
    STAT="$(git -C /workspace diff --stat "$BEFORE_SHA".."$AFTER_SHA" | head -20)"
    SUMMARY="commit: ${AFTER_SHA}
files changed:
${FILES}

diff stat:
${STAT}"
fi

# B1: Emit SandboxProgramContract envelope
emit "$SUMMARY"
