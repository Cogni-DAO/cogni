# Bootstrap - Development Environment Setup

One-time development machine and repository setup.

## Quick Start

```bash
# From repository root
scripts/bootstrap/setup.sh
```

This installs Node.js 22 (via Volta), pnpm, Docker Desktop, project dependencies, and git hooks. After installation, it runs pre-flight checks and offers to start the dev stack.

### Install All Tools

```bash
scripts/bootstrap/setup.sh --all
```

Adds OpenTofu (infrastructure) and REUSE (license compliance) for fork owners deploying infrastructure.

## What Gets Installed

| Tool           | Default | --all | Purpose                                |
| -------------- | ------- | ----- | -------------------------------------- |
| Volta          | ✓       | ✓     | Node.js version manager (pins to 22.x) |
| Node.js 22     | ✓       | ✓     | JavaScript runtime                     |
| pnpm 9         | ✓       | ✓     | Package manager                        |
| Docker Desktop | ✓       | ✓     | Container runtime with compose v2      |
| OpenTofu       |         | ✓     | Infrastructure as Code                 |
| REUSE          |         | ✓     | License compliance checking            |
| age + sops     |         | ✓     | GitOps secret encryption (Argo CD)     |

## Individual Installers

Located in `install/`:

```bash
scripts/bootstrap/install/install-pnpm.sh     # Volta + Node 22 + pnpm
scripts/bootstrap/install/install-docker.sh   # Docker Desktop + daemon check
scripts/bootstrap/install/install-project.sh  # pnpm install + packages:build + git hooks
scripts/bootstrap/install/install-tofu.sh     # OpenTofu
scripts/bootstrap/install/install-reuse.sh    # REUSE tool
```

Additional scripts:

```bash
scripts/bootstrap/simple-local-env-setup.sh    # Copy .env.local.example → .env.local
scripts/bootstrap/setup-gitops-secrets.sh      # Generate age keypairs + update .sops.yaml
scripts/bootstrap/install/install-gitops-tools.sh  # Install age + sops
```

## Platform Support

- **macOS**: Full automated installation (Docker Desktop install prompts for system password)
- **Linux/Other**: Guided manual installation

## Pre-flight Checks

Before offering to start `dev:stack`, the setup script verifies:

- Node.js version is 22.x
- Docker daemon is running
- `docker compose` v2 is available

## Next Steps

```bash
cp .env.local.example .env.local  # Add your OpenRouter API key
pnpm dev:stack                    # Start full dev stack
pnpm check                        # Run validation checks
```
