#!/bin/bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# OpenCode Coding Agent Runner
# Reads COGNI_MODEL from graph executor, runs OpenCode against LiteLLM proxy.
# Output: JSON summary of files changed and commit SHA.

set -euo pipefail

MODEL="${COGNI_MODEL:?COGNI_MODEL env var required}"
API_BASE="${OPENAI_API_BASE:-http://localhost:8080}"

# Task input
if [[ -f /workspace/task.md ]]; then
    TASK_MSG="$(cat /workspace/task.md)"
elif [[ -n "${TASK:-}" ]]; then
    TASK_MSG="$TASK"
else
    echo '{"error":"No task. Provide /workspace/task.md or TASK env var"}' >&2
    exit 1
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

# OpenCode config: model and API endpoint via environment
# OpenCode reads OPENAI_API_KEY and uses --provider/--model flags
export OPENAI_API_KEY="${LITELLM_API_KEY:-sk-cogni}"
export OPENAI_BASE_URL="$API_BASE/v1"

# Run OpenCode non-interactively with the task prompt
# -p flag runs single prompt then exits; -f json for structured output
opencode -p "$TASK_MSG" -m "$MODEL" 2>/dev/null || true

AFTER_SHA="$(git -C /workspace rev-parse HEAD 2>/dev/null || echo 'none')"

# Emit result summary
if [[ "$BEFORE_SHA" == "$AFTER_SHA" ]]; then
    FILES="[]"
    STAT=""
else
    FILES="$(git -C /workspace diff --name-only "$BEFORE_SHA".."$AFTER_SHA" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
    STAT="$(git -C /workspace diff --stat "$BEFORE_SHA".."$AFTER_SHA" | head -20)"
fi

cat <<RESULT
{"files_changed":${FILES:-[]},"commit_sha":"${AFTER_SHA}","diff_stat":"$(echo "$STAT" | tr '\n' '|')"}
RESULT
