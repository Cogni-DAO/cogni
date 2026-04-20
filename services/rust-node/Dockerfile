# syntax=docker/dockerfile:1.7-labs
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

FROM rust:1-bookworm AS builder
WORKDIR /app

COPY services/rust-node ./services/rust-node
RUN cargo build --manifest-path services/rust-node/Cargo.toml --package cogni-rust-node-runtime --release

FROM debian:bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 rustnode
USER rustnode
WORKDIR /app

COPY --from=builder --chown=rustnode:nodejs /app/services/rust-node/target/release/cogni-rust-node-runtime /usr/local/bin/cogni-rust-node-runtime

ENV HOST=0.0.0.0
ENV PORT=9101
ENV DEFAULT_ACCOUNT_BALANCE_CREDITS=50000

ARG GIT_SHA=unknown
ARG BUILD_TS=unknown
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TS=${BUILD_TS}

EXPOSE 9101
CMD ["cogni-rust-node-runtime"]
