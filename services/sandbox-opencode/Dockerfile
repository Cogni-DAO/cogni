# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Sandbox OpenCode Container
# Coding agent using OpenCode (Go binary) with COGNI_MODEL passthrough.
# Per SANDBOXED_AGENTS.md: ephemeral per task, LLM access via socat bridge.

FROM golang:1.23-bookworm AS builder
RUN go install github.com/opencode-ai/opencode@latest

FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    socat git jq curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN addgroup --system --gid 1001 sandbox && \
    adduser --system --uid 1001 --gid 1001 sandboxer && \
    mkdir -p /workspace && chown sandboxer:sandbox /workspace

COPY --from=builder /go/bin/opencode /usr/local/bin/opencode
COPY --chmod=755 entrypoint.sh /usr/local/bin/sandbox-entrypoint.sh
COPY --chmod=755 run.sh /usr/local/bin/opencode-run.sh

USER sandboxer
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint.sh"]
CMD ["opencode-run.sh"]
