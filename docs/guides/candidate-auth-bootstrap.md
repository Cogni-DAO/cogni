# Candidate Auth Bootstrap — Authed Playwright via CDP Attach

> Goal: capture a reusable signed-in browser session for `{env}.cognidao.org` so AI agents (Claude, qa-agent) can drive authed Playwright flows without re-prompting MetaMask on every run.
>
> Human effort: one-time MetaMask install into a dedicated Chrome profile (~2 min), then 1–2 clicks to sign in per env. Recapture when the session cookie expires (days–weeks).

## Why this exists

Playwright launches a fresh Chromium profile with no extensions — MetaMask and other wallet extensions therefore do not work in the normal `browser.newContext()` flow. Work around it by launching **a dedicated Chrome profile** (with MetaMask installed), signing in once, then exporting the resulting session cookies via CDP attach. Future Playwright runs load the exported `storageState.json` and are authenticated without needing a wallet at all.

The session cookie is the auth artifact. MetaMask only participates in the *first* signin to mint the cookie.

## Why a dedicated profile (not your default Chrome)

Chrome 136+ **disables** `--remote-debugging-port` when launched against the default user data dir, as a security mitigation (default profile cookies are an attractive target for malware using CDP). A dedicated profile dir bypasses this cleanly. One-time MetaMask install into the new profile is the only setup cost.

## Storage layout (in repo, gitignored)

```
.cogni/auth/
  chrome-profile/                           # dedicated Chrome user data dir (MetaMask lives here)
  credentials.md                            # MetaMask password + recovery phrase (test wallet only)
  candidate-a-poly.storageState.json        # poly-test.cognidao.org
  candidate-a-operator.storageState.json    # test.cognidao.org
  ...
```

`.cogni/.gitignore` excludes the entire `auth/` subtree. Never commit — these files hold live session cookies, and the profile dir holds the MetaMask vault.

## One-time setup (per laptop)

1. **Quit all Chrome windows** (⌘Q). Verify nothing is running: `pgrep -lf "Google Chrome"` should be empty.
2. Launch Chrome pointed at the dedicated profile, with CDP enabled:

   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --user-data-dir="$PWD/.cogni/auth/chrome-profile"
   ```

   Keep that terminal tab open — closing it kills Chrome.

3. **Install MetaMask** into this profile:
   - **Skip / reject every Google sign-in prompt.** Don't sign into Chrome with a Google account, don't enable sync, dismiss any "Turn on sync" banners. This profile is a throwaway test rig — signing in pollutes it with your real identity and defeats the isolation.
   - Go to `https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn`
   - Click "Add to Chrome"
   - MetaMask setup: choose **Create a new wallet** (preferred) or **Import existing** if you already have a dedicated test seed.
   - **Suggested password:** `cogni-is-the-goat` (low-stakes — this profile is test-only and gitignored). If you pick something else, write it down in `.cogni/auth/credentials.md` so the next agent/session can unlock.
   - Finish setup. MetaMask shows you a 12-word recovery phrase — **save it into `.cogni/auth/credentials.md` immediately**. That file is gitignored. Without it, a wiped profile means a lost wallet.
   - **Seed confirmation step:** MetaMask then asks the user to fill in 3 specific word positions (e.g. "2, 5, 8") from a shuffled word pool. The AI agent should read `.cogni/auth/credentials.md`, map the requested positions to the saved phrase, and tell the user exactly which word goes in each slot. Don't make the user count words manually.
   - Unlock MetaMask.

4. Verify CDP is listening:

   ```bash
   curl -s http://localhost:9222/json/version | jq .Browser
   # -> "Chrome/<version>"
   ```

The profile now persists under `.cogni/auth/chrome-profile/`. Future launches reuse it — MetaMask stays installed, stays funded with whatever account you imported.

## Per-environment: sign in and capture

1. In the debuggable Chrome, navigate to the target env (e.g. `https://poly-test.cognidao.org`).
2. Sign-in is typically **2 MetaMask prompts** (up to 4 clicks total):
   - Click "Sign in" / "Connect wallet"
   - MetaMask **Connect** popup → approve the connection
   - Site then issues a SIWE message
   - MetaMask **Sign** popup → sign the message
3. Confirm you're signed in (avatar/account visible, or redirect to an authed page).
4. **Leave that tab open**, then from the repo root:

   ```bash
   node scripts/dev/capture-authed-state.mjs candidate-a-poly https://poly-test.cognidao.org
   ```

   Writes `.cogni/auth/candidate-a-poly.storageState.json` and prints cookie/domain counts as sanity check.

## Using captured state from Playwright

```ts
import { chromium } from "@playwright/test";
import path from "node:path";

const storageState = path.join(
  process.cwd(),
  ".cogni/auth/candidate-a-poly.storageState.json",
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState });
const page = await ctx.newPage();
await page.goto("https://poly-test.cognidao.org");
// already signed in — no MetaMask needed
```

## Refresh cadence

- Sessions generally persist for days to weeks depending on the env's cookie TTL.
- When an agent run hits "unauthenticated", re-run the sign-in + capture flow. MetaMask is only needed to re-mint the cookie.
- Clearing `.cogni/auth/chrome-profile/` wipes MetaMask — you'd have to re-import the seed phrase.

## Troubleshooting

- **`curl localhost:9222` refused but Chrome is running:** you pointed `--user-data-dir` at the default profile. Chrome 136+ blocks CDP there. Use `.cogni/auth/chrome-profile/` as shown.
- **Still refused with dedicated profile:** another Chrome instance is holding the profile lock. Run `pgrep -lf "Google Chrome"`, kill stragglers, retry.
- **MetaMask popup doesn't appear on signin:** unlock the extension (click the fox icon, enter password). Extensions stay locked across Chrome restarts.
- **Captured state has no cookies for the expected domain:** you signed in before the capture script could see the tab. Make sure the tab is still open at the target URL when you run the script.
- **Playwright runs but site redirects to signin:** cookie expired — recapture. *Or:* the site stores auth in `localStorage` rather than cookies, and CDP-attach export reports `origins: 0`. In that case the captured `storageState.json` is insufficient; a dedicated Playwright authfile step (using `browser.newContext({ storageState })` against a Playwright-launched browser + manual signin inside Playwright) may be needed. Tracked as a known gap — update this guide when resolved.

## Done for the session — getting back to your normal browser

When you're finished capturing state:

1. **Fully quit** the debuggable Chrome window: ⌘Q inside that window (closing via the red dot does not quit the process). The agent can also kill it by PID: `pgrep -f "remote-debugging-port" | xargs kill`.
2. Open Chrome normally from Applications / Spotlight / Dock — it launches with your real default profile (bookmarks, extensions, history all there).

Notes:

- The macOS "default browser" setting is **app-level**, not profile-level. If macOS prompted "Make Chrome your default browser" when the debug profile launched, nothing meaningful changed — Chrome-the-app is still the default either way.
- You **can run both at once**: the debug profile and your normal profile coexist as separate Chrome processes because they point at different `--user-data-dir`s. Launch one with the debug flag + `.cogni/auth/chrome-profile/`, open the other from the Dock. The only conflict is two processes sharing one profile dir (Chrome refuses that with a lock-file error). When both are running, macOS may open new-window link clicks in whichever Chrome launched most recently — keep that in mind while automating.

## Scope / non-goals

- Per-developer primitive. Multi-tenant / credential-broker flows for production agents are tracked separately (see `spike.0230`).
- No headless capture — signin is inherently interactive.
- Not for CI — CI uses API-key or service-account auth, not SIWE.
