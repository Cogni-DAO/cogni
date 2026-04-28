import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "node",
  external: [
    "@cogni/ai-core",
    "@cogni/ai-tools",
    "zod",
  ],
});

// biome-ignore lint/style/noDefaultExport: required by tsup
export default tsupConfig;
