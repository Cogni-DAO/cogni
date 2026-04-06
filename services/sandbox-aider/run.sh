#!/bin/bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Aider Coding Agent Runner
# Reads COGNI_MODEL from graph executor, runs Aider against LiteLLM proxy.
# Output: JSON summary of files changed and commit SHA.

set -euo pipefail

# Model comes from graph executor via COGNI_MODEL env var
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
git config --global user.email "cogni-aider@cognidao.org"
git config --global user.name "Cogni Aider Agent"
git config --global init.defaultBranch main

# Init git if needed (aider requires git repo)
if [[ ! -d /workspace/.git ]]; then
    git init /workspace
    git -C /workspace add -A 2>/dev/null || true
    git -C /workspace commit -m "initial" --allow-empty 2>/dev/null || true
fi

BEFORE_SHA="$(git -C /workspace rev-parse HEAD 2>/dev/null || echo 'none')"

# Run aider — model from COGNI_MODEL, API from LiteLLM proxy
aider \
    --model "$MODEL" \
    --openai-api-base "$API_BASE/v1" \
    --openai-api-key "${LITELLM_API_KEY:-sk-cogni}" \
    --message "$TASK_MSG" \
    --yes \
    --no-stream \
    --auto-commits \
    --no-suggest-shell-commands \
    --no-auto-lint \
    --no-auto-test

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
