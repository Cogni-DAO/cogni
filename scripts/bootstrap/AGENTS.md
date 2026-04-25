# bootstrap · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Development environment setup installers for one-time machine and repository configuration.

## Pointers

- [install/](install/): Individual installer scripts
- [README.md](README.md): Installation instructions and usage guide

## Boundaries

```json
{
  "layer": "scripts",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Public Surface

- **Exports:** none
- **CLI (if any):** `setup.sh`, `simple-local-env-setup.sh`, `install/*.sh` scripts
- **Files considered API:** `setup.sh`, `simple-local-env-setup.sh`, `install/*.sh`

## Responsibilities

- This directory **does**: Install development tools and configure project environment
- This directory **does not**: Handle runtime application dependencies or deployment

## Usage

One-command setup (recommended for new developers):

```bash
./setup.sh           # Install tools + set up dev/test environments
./setup.sh --all     # Also install OpenTofu and REUSE
```

Individual installers:

```bash
install/install-pnpm.sh                 # Volta + Node.js + pnpm
install/install-docker.sh               # Docker Desktop
install/install-ripgrep.sh              # rg (brain repo search)
install/install-yq.sh                   # mikefarah/yq v4 (CATALOG_IS_SSOT)
install/install-tofu.sh                 # Infrastructure tooling (optional, --all)
install/install-reuse.sh                # License compliance (optional, --all)
install/install-check-jsonschema.sh     # Catalog schema validation (opt-in; CI is authoritative)
```

## Standards

- Individual focused scripts instead of monolithic installer
- Platform detection with fallback instructions
- Idempotent installations with existence checks

## Dependencies

- **Internal:** none
- **External:** Homebrew (macOS), system package managers

## Change Protocol

- Update this file when **installer interfaces** change
- Bump **Last reviewed** date
- Update README.md when new installers added

## Notes

- Scripts handle macOS via Homebrew with manual fallback instructions
- Broken apart from original monolithic bootstrap script
