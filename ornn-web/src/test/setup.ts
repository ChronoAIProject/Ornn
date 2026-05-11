import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import en from "../i18n/en.json";

function lookupKey(path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<unknown>((node, segment) => {
      if (node && typeof node === "object" && segment in (node as Record<string, unknown>)) {
        return (node as Record<string, unknown>)[segment];
      }
      return undefined;
    }, en as unknown);
  return typeof value === "string" ? value : undefined;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      let template: string | undefined;
      let interp: Record<string, unknown> = {};
      if (typeof fallbackOrOpts === "string") {
        template = lookupKey(key) ?? fallbackOrOpts;
        interp = (opts as Record<string, unknown>) ?? {};
      } else if (fallbackOrOpts && typeof fallbackOrOpts === "object") {
        template = lookupKey(key) ?? key;
        interp = fallbackOrOpts as Record<string, unknown>;
      } else {
        template = lookupKey(key) ?? key;
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
