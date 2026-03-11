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
  ],
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
