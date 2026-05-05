import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Default i18n stub for component tests. Returns the second argument
 * (the English fallback text) when present, with `{{var}}` placeholders
 * substituted from the options bag — enough to drive `getByText` /
 * `getByRole({ name })` queries without spinning up the full i18next
 * runtime per test file.
 *
 * Tests can `vi.unmock("react-i18next")` if they need real i18n.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      let template: string = key;
      let interp: Record<string, unknown> = {};
      if (typeof fallbackOrOpts === "string") {
        template = fallbackOrOpts;
        interp = (opts as Record<string, unknown>) ?? {};
      } else if (fallbackOrOpts && typeof fallbackOrOpts === "object") {
        interp = fallbackOrOpts as Record<string, unknown>;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        interp[name] != null ? String(interp[name]) : `{{${name}}}`,
      );
    },
    i18n: { changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children,
}));
