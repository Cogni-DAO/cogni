import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@cogni/node-shared"],
  outputFileTracingRoot: path.join(__dirname, "../../../"),
  typescript: {
    tsconfigPath: "./tsconfig.app.json",
  },
};

export default nextConfig;
