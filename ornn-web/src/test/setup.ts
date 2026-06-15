import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import en from "../i18n/en.json";

// jsdom ships no ResizeObserver; react-flow (@xyflow/react, #1067) reads it on
// mount. A no-op stub keeps the lazy dependency-graph canvas from crashing the
// test render — the canvas's edit wiring is asserted via the click-to-connect
// node grid, not via react-flow's measured layout.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

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
