import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/graphs/index.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "node",
  external: ["@langchain/langgraph", "@cogni/ai-tools", "@cogni/langgraph-graphs"],
});
