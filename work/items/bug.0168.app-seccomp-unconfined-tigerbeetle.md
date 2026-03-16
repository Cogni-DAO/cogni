---
id: bug.0168
type: bug
title: "App container uses seccomp=unconfined for TigerBeetle io_uring — replace with targeted profile"
status: ready
priority: 2
rank: 30
estimate: 1
summary: "seccomp=unconfined on app container disables all syscall filtering. Only 3 io_uring syscalls are needed. Create a custom seccomp profile extending Docker's default."
outcome: "App container runs with Docker default seccomp + only io_uring_setup, io_uring_enter, io_uring_register added. No other syscall restrictions removed."
spec_refs: operator-wallet
assignees:
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-16
updated: 2026-03-16
labels: [security, infra, docker]
external_refs:
---

# App container uses seccomp=unconfined for TigerBeetle io_uring

## Problem

The TigerBeetle native client (`tigerbeetle-node`) uses `io_uring` syscalls. Docker's default seccomp profile blocks these. As a workaround, `seccomp=unconfined` was added to the app container in both dev and production compose files.

This disables **all** ~44 blocked syscalls (including `bpf`, `mount`, `kexec_load`, `reboot`, etc.), widening the attack surface if RCE is achieved in the app container.

## Fix

Create a custom seccomp profile JSON that copies Docker's default and adds only:
- `io_uring_setup`
- `io_uring_enter`
- `io_uring_register`

Reference: https://docs.docker.com/engine/security/seccomp/

Apply via:
```yaml
security_opt:
  - "seccomp=./configs/seccomp-app.json"
```

## Affected files

- `infra/compose/runtime/docker-compose.yml` — app service
- `infra/compose/runtime/docker-compose.dev.yml` — app service (added in 2a1a05b0)
- New: `infra/compose/runtime/configs/seccomp-app.json`
