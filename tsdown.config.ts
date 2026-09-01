import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  clean: true,
  dts: true,
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  target: "node24",
});
