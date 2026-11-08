import { withRsbuildConfig } from "@rstest/adapter-rsbuild";
import { defineConfig } from "@rstest/core";

export default defineConfig({
  extends: withRsbuildConfig(),
  testEnvironment: "node",
  include: ["src/**/*.test.ts"],
  exclude: ["**/node_modules/**", "**/dist/**"],
});
