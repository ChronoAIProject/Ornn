/// <reference types="vitest" />
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      css: false,
      coverage: {
        provider: "v8",
        all: true,
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/test/**",
          "src/**/*.{test,spec}.{ts,tsx}",
          "src/**/*.d.ts",
          "src/main.tsx",
        ],
        reporter: ["text", "lcov", "json-summary"],
        reportsDirectory: "coverage",
        // Floor only — measured 14.88% at introduction (#889). Raise deliberately, never auto-track.
        thresholds: { lines: 12 },
      },
    },
  }),
);
