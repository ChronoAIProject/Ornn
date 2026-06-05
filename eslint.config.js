import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", "**/*.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["ornn-web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      // compiler-only advisory — re-enable when babel-plugin-react-compiler lands (#888, 2026-06-05)
      "react-hooks/preserve-manual-memoization": "off",
      // compiler-only advisory — re-enable when babel-plugin-react-compiler lands (#888, 2026-06-05)
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Architecture boundary: route handlers must not invoke repositories
  // directly. Routes depend on services; services own data access.
  //
  // This rule catches only *runtime* repo imports in route files.
  // `import type { ... }` is still allowed so route files can type
  // their Config interfaces off the repository classes (common pattern
  // while the full service-extraction refactor is pending).
  //
  // Catches the easy case. The harder case (runtime method calls via
  // config-passed repo instances) requires a custom rule; tracked as
  // follow-up to Epic 4.
  {
    files: ["ornn-api/src/domains/**/routes.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/repository", "**/repositories/*"],
              message:
                "Routes must not import repositories at runtime. Use the service layer instead. `import type` is still allowed.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
