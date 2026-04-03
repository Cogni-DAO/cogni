---
id: task.0271
type: task
title: "EAS Build + TestFlight + App Store submission"
status: needs_implement
priority: 3
rank: 8
estimate: 2
summary: "Configure Expo Application Services (EAS) for production builds. Submit to TestFlight for beta testing, then App Store."
outcome: "Cogni mobile app is available on the Apple App Store (and Google Play Store)."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0269]
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
---

# EAS Build + TestFlight + App Store submission

## Goal

Ship the app to users via app stores.

## Implementation Plan

- [ ] Create `eas.json` with development, preview, and production build profiles
- [ ] Configure `app.json` / `app.config.ts` with bundle ID, version, icons, splash
- [ ] Set up Apple Developer account and App Store Connect
- [ ] Set up Google Play Developer account and Play Console
- [ ] Run `eas build --platform ios --profile production`
- [ ] Submit to TestFlight, internal testing
- [ ] Write App Store listing (screenshots, description, privacy policy)
- [ ] Submit for App Store review
- [ ] Submit to Google Play Store

## Validation

```bash
eas build --platform ios --profile preview  # verify build succeeds
# Manual: install TestFlight build on physical device, verify all flows work
```
