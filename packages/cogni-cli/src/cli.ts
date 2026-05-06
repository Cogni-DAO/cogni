// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/cli`
 * Purpose: Binary entrypoint for the `cogni` command. Routes subcommands.
 * Scope: Argv parsing + dispatch only. Does not implement any subcommand body — all real work lives in command modules.
 * Invariants: v0 supports exactly one subcommand: `dev`. Unknown subcommands exit non-zero with usage.
 * Side-effects: IO (process.argv, stdout, spawned subprocesses through commands)
 * Links: src/dev/index.ts
 * @public
 */

import { runDev } from "./dev/index.js";

const USAGE = `
cogni — local developer CLI for the Cogni operator

Usage:
  cogni dev [options]            Start a local agent runtime and connect it
                                 to the operator's /runtimes/dev page via a
                                 Cloudflare quick tunnel.

Options for \`cogni dev\`:
  --host <host>                  Operator host (default: test.cognidao.org)
  --port <port>                  Local server port (default: 0 = random)
  --workdir <path>               Working directory passed to spawned agents
                                 (default: process.cwd())
  --no-open                      Do not open the browser automatically.
  --no-tunnel                    Skip cloudflared; serve on http://localhost
                                 only (the page will be unreachable from a
                                 hosted UI under HTTPS — useful for debugging).
  --print-url-only               Print the studio URL on stdout and stay alive,
                                 but do not open a browser.

Environment:
  COGNI_API_KEY                  Optional. Validated against
                                 https://<host>/.well-known/agent.json before
                                 starting; not required for the v0 prototype.
`.trim();

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return subcommand ? 0 : 1;
  }

  if (subcommand === "dev") {
    return await runDev(argv.slice(1));
  }

  process.stderr.write(`cogni: unknown subcommand: ${subcommand}\n\n`);
  process.stderr.write(`${USAGE}\n`);
  return 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cogni: fatal: ${message}\n`);
    process.exit(1);
  });
