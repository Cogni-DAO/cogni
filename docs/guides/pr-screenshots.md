---
id: guide.pr-screenshots
type: guide
title: "PR Screenshots — Playwright capture + GitHub release assets workflow"
status: draft
trust: draft
summary: Step-by-step guide for taking desktop and mobile screenshots of the operator UI from a dev worktree and publishing them to a pull request via GitHub release assets.
read_when: You are adding visual evidence to a UI pull request and need to capture and upload screenshots programmatically.
owner: derekg1729
created: 2026-04-08
verified:
tags: [playwright, screenshots, pr, ui, workflow]
---

# PR Screenshots Guide

Capture and publish desktop + mobile screenshots for UI pull requests.

## Prerequisites

- `playwright-cli` installed globally (`npm i -g playwright-cli`)
- `gh` CLI authenticated
- Dev server accessible (see below)

## Full workflow

### 1. Start the dev server from the worktree

```bash
cd nodes/operator/app
npx next dev --port 3099 &>/tmp/next-dev.log &

# Wait for ready
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/ | grep -q 200; do sleep 2; done
echo "Ready"
```

Use a non-standard port (e.g. `3099`) to avoid conflicting with the main dev workflow on `3000`.

### 2. Seed auth for protected pages (if needed)

The homepage (`/`) is public — no auth required. For authenticated pages, seed a session via `localStorage`:

```bash
playwright-cli open http://localhost:3099/
# Set a NextAuth session token directly in localStorage or cookie
playwright-cli cookie-set next-auth.session-token "<token>" --domain=localhost
playwright-cli state-save /tmp/auth-state.json
playwright-cli close

# Then reuse for screenshots:
playwright-cli open --config /tmp/auth-state.json http://localhost:3099/dashboard
```

For the operator app, you can seed a dev session by signing in once via the UI and saving state:

```bash
playwright-cli open http://localhost:3099/
# complete sign-in flow manually or via playwright actions
playwright-cli state-save /tmp/operator-auth.json
playwright-cli close
```

### 3. Take desktop screenshot

```bash
mkdir -p /tmp/pr-screenshots
playwright-cli open http://localhost:3099/
playwright-cli resize 1440 900
sleep 3   # let Three.js / animations render
playwright-cli screenshot --filename=/tmp/pr-screenshots/homepage-desktop.png
```

### 4. Take mobile screenshot

```bash
playwright-cli resize 390 844
sleep 2
playwright-cli screenshot --filename=/tmp/pr-screenshots/homepage-mobile.png
playwright-cli close
```

### 5. Upload to GitHub via release assets

GitHub's `user-attachments` CDN (used when pasting images in the UI) is **not accessible via the REST API** — it requires browser-based CSRF auth. Instead, use a pre-release as an image host:

```bash
PR_NUMBER=827  # change per PR

gh release create "pr-${PR_NUMBER}-screenshots" \
  --repo Cogni-DAO/node-template \
  --title "PR #${PR_NUMBER} Screenshots" \
  --notes "Image host for PR #${PR_NUMBER} — can be deleted after merge." \
  --prerelease \
  /tmp/pr-screenshots/homepage-desktop.png \
  /tmp/pr-screenshots/homepage-mobile.png
```

This produces stable public URLs:

```
https://github.com/Cogni-DAO/node-template/releases/download/pr-${PR_NUMBER}-screenshots/homepage-desktop.png
https://github.com/Cogni-DAO/node-template/releases/download/pr-${PR_NUMBER}-screenshots/homepage-mobile.png
```

### 6. Add screenshots to the PR body

Edit the PR body to prepend the screenshots section:

```bash
gh pr edit $PR_NUMBER --repo Cogni-DAO/node-template --body "$(cat <<'BODY'
## Screenshots

**Desktop (1440×900)**

<img width="1440" alt="homepage-desktop" src="https://github.com/Cogni-DAO/node-template/releases/download/pr-NNN-screenshots/homepage-desktop.png" />

**Mobile (390×844)**

<img width="390" alt="homepage-mobile" src="https://github.com/Cogni-DAO/node-template/releases/download/pr-NNN-screenshots/homepage-mobile.png" />

---

[... rest of existing PR body ...]
BODY
)"
```

### 7. Clean up

```bash
kill $(lsof -ti :3099)           # stop dev server
rm -rf /tmp/pr-screenshots       # clean temp files
# Optionally delete the release after merge:
# gh release delete pr-${PR_NUMBER}-screenshots --repo Cogni-DAO/node-template --yes
```

## Notes

- **Do not commit screenshots to git** — use release assets as the image host.
- **Draft releases don't render in markdown** — publish as `--prerelease` so the download URLs resolve publicly.
- **Three.js pages need a delay** — `sleep 3` after `goto` lets the canvas render before capturing.
- The `--filename` flag on `playwright-cli screenshot` saves to an absolute path; omitting it saves a timestamped file in `.playwright-cli/`.
