---
id: task.0270
type: task
title: "SIWE wallet auth via WalletConnect on mobile"
status: needs_design
priority: 3
rank: 7
estimate: 3
summary: "Add Sign-In With Ethereum to mobile app using WalletConnect + wagmi v1.x. Deep-link flow: app → wallet → sign → return to app with JWT."
outcome: "Users can sign in with their Ethereum wallet on mobile, matching the web app's SIWE flow."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0266]
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
---

# SIWE wallet auth via WalletConnect on mobile

## Goal

Wallet-based authentication on mobile. This is the harder auth path — requires WalletConnect deep-linking to work reliably.

## Design Needed

- wagmi v1.x vs v2 compatibility in monorepo (audit `@cogni/node-shared` for wagmi imports)
- WalletConnect deep-link flow validation on iOS and Android
- Fallback UX if wallet app is not installed
- SIWE message signing flow on mobile vs web differences

## Implementation Plan (pending design)

- [ ] Install `@web3modal/wagmi-react-native`, `wagmi` v1.x, `viem`
- [ ] Install polyfills: `react-native-get-random-values`, `@ethersproject/shims`
- [ ] Configure WalletConnect project ID
- [ ] Implement SIWE flow: connect wallet → sign message → POST to NextAuth → store JWT
- [ ] Test with MetaMask mobile, Rainbow, and Coinbase Wallet
- [ ] Handle deep-link return (app ↔ wallet round-trip)

## Validation

```bash
# Manual: sign in with MetaMask on iOS, verify JWT stored, API calls authenticated
# Manual: test wallet-not-installed fallback
```
