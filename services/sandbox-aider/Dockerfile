# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Sandbox Aider Container
# Coding agent using Aider (paulgauthier/aider) with COGNI_MODEL passthrough.
# Per SANDBOXED_AGENTS.md: ephemeral per task, LLM access via socat bridge.

FROM paulgauthier/aider:latest

USER root

# Install socat for LLM proxy socket bridge (same pattern as sandbox-runtime)
RUN apt-get update && apt-get install -y --no-install-recommends socat && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN addgroup --system --gid 1001 sandbox && \
    adduser --system --uid 1001 --gid 1001 sandboxer && \
    mkdir -p /workspace && chown sandboxer:sandbox /workspace

COPY --chmod=755 entrypoint.sh /usr/local/bin/sandbox-entrypoint.sh
COPY --chmod=755 run.sh /usr/local/bin/aider-run.sh

USER sandboxer
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint.sh"]
CMD ["aider-run.sh"]
