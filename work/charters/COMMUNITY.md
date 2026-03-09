---
id: chr.community
type: charter
title: "COMMUNITY Charter"
state: Active
summary: COMMUNITY governance charter scaffold for recurring heartbeat runs.
created: 2026-02-15
updated: 2026-02-15
---

# COMMUNITY Charter

## Goal

Grow a community aligned around the core charter: empowering people to co-build technology as a DAO

## Projects

### Core mission / priorities

| Priority | Target                                               | Score (0-5) | Status      | Notes                                      |
| -------- | ---------------------------------------------------- | ----------- | ----------- | ------------------------------------------ |
| P0       | Active communication channels for community reach    | 0           | Not Started | Messenger channels not connected           |
| P1       | Governance transparency: community sees ongoing runs | 0           | Not Started | No public dashboard; project doesn't exist |
| P2       | Contribution incentives via web3 cred                | 0           | Not Started | SourceCred exists but doesn't run          |

### Top projects (max 4)

| Project                       | Why now                                                       | Score (0-5) | Status      | Notes                         |
| ----------------------------- | ------------------------------------------------------------- | ----------- | ----------- | ----------------------------- |
| `proj.messenger-channels`     | BLOCKING: Zero community reach without communication channels | 0           | Not Started | OpenClaw channels; P0 ready   |
| **[governance-transparency]** | **Community must see governance runs to trust the system**    | 0           | **TODO**    | **Project doesn't exist yet** |
| `proj.web3-gov-mvp`           | Community needs governance participation surface (proposals)  | 0           | Not Started | Aragon integration exists     |
| `proj.sourcecred-onchain`     | Incentivize contributions with cred/rewards                   | 0           | Not Started | Paused; prototype doesn't run |

## Constraints

- Community of 1 (Derek)
- No means of contacting community for help
- No public visibility into governance runs
- No running incentive system (SourceCred configured but not executing)

### Skills / resources

| Resource                  | Use                                  | Where                        | /skill | Notes                              |
| ------------------------- | ------------------------------------ | ---------------------------- | ------ | ---------------------------------- |
| Messenger channels        | Community communication surface      | `services/openclaw-gateway/` |        | OpenClaw channels; not connected   |
| Web3 governance contracts | Proposal creation, voting            | `packages/aragon-osx/`       |        | Deployed; no community yet         |
| SourceCred                | Contribution tracking and rewards    | SourceCred config            |        | Configured but not running         |
| Work items / docs         | Transparency: community sees roadmap | `work/`, `docs/`             |        | Public read access; no write hooks |
