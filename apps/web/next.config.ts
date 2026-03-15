import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // In monorepo: tell Next.js where the workspace root is so standalone output
  // includes shared packages and resolves node_modules correctly.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // dockerode → ssh2 → cpu-features has a native .node addon that Turbopack
  // cannot resolve when built with --ignore-scripts. Leave as runtime require().
  serverExternalPackages: [
    "dockerode",
    "ssh2",
    "cpu-features",
    "pino",
    "pino-pretty",
    "tigerbeetle-node",
    "@cogni/financial-ledger",
  ],
  // WalletConnect pulls pino@7 → thread-stream@0.15 which ships test files
  // requiring 'tape'. outputFileTracingRoot broadens tracing to monorepo root,
  // exposing these. Exclude test/bench dirs from tracing.
  outputFileTracingExcludes: {
    "/**": [
      "**/thread-stream/test/**",
      "**/pino/test/**",
      "**/pino/benchmarks/**",
    ],
  },
  // Temporary containment (bug.0157): WalletConnect pulls pino@7 → thread-stream
  // which ships test files requiring 'tape'/'tap'. Stub thread-stream for Turbopack
  // so it doesn't follow the test-file dependency chain during Client Component SSR.
  turbopack: {
    resolveAlias: {
      "thread-stream": "./src/shared/stubs/thread-stream-noop.ts",
    },
  },
  typescript: {
    tsconfigPath: "./tsconfig.app.json",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "sonarcloud.io",
        pathname: "/api/project_badges/measure",
      },
    ],
  },
};

export default nextConfig;
