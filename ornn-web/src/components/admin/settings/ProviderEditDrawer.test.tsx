/**
 * ProviderEditDrawer tests — entity-switch reset via key remount (#888).
 *
 * The inner form is keyed on `provider?._id ?? "new"` so its
 * lazy-initialised state resets by construction when the open drawer
 * switches from provider A to provider B without closing. Without the key,
 * A's edited (dirty) connection fields would survive into B's form.
 *
 * STALE-STATE-FIRST oracle: open on A, DIRTY the Name field, then switch
 * the `provider` prop to B while the drawer stays open → B's values render
 * and A's dirt is gone.
 *
 * Mocks the toast store directly + wraps in a QueryClientProvider (the
 * drawer's save mutation is built inline with `useMutation`). The mutation
 * never fires in these tests — we only assert form state across the prop
 * switch — so the network functions are never reached. framer-motion is
 * stubbed pass-through. react-i18next is stubbed globally in
 * src/test/setup.ts.
 *
 * @module components/admin/settings/ProviderEditDrawer.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { LlmProvider } from "@/services/settingsApi";

const addToast = vi.fn();

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({
          children,
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _tr,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          void _i;
          void _a;
          void _e;
          void _tr;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  ),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

// Stub the settings API module so importing the drawer doesn't pull in the
// apiClient → authStore init chain (which writes to localStorage on module
// load). The mutation never fires in these tests; only `isSecretPreserveValue`
// is read by the SecretField at render time, so it's the one behaviour we
// preserve.
vi.mock("@/services/settingsApi", () => ({
  createLlmProvider: vi.fn(),
  updateLlmProvider: vi.fn(),
  isSecretPreserveValue: (v: string) => v.includes("•"),
}));

import { ProviderEditDrawer } from "./ProviderEditDrawer";

const PROVIDER_A: LlmProvider = {
  _id: "prov-a",
  name: "Alpha Gateway",
  gatewayUrl: "https://alpha.example.com/v1",
  modelListUrl: "https://alpha.example.com/v1/models",
  apiFormat: "chat-completion",
  auth: { kind: "apiKey", apiKey: "alpha-key" },
  models: [],
  maxOutputTokens: 4096,
  defaultTemperature: 0.7,
};

const PROVIDER_B: LlmProvider = {
  _id: "prov-b",
  name: "Bravo Gateway",
  gatewayUrl: "https://bravo.example.com/v1",
  modelListUrl: "https://bravo.example.com/v1/models",
  apiFormat: "responses",
  auth: { kind: "apiKey", apiKey: "bravo-key" },
  models: [],
  maxOutputTokens: 8192,
  defaultTemperature: 1.0,
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function inputValues(): string[] {
  return (screen.getAllByRole("textbox") as HTMLInputElement[]).map((el) => el.value);
}

beforeEach(() => {
  addToast.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ProviderEditDrawer — entity-switch reset", () => {
  it("prefills the form from the provider prop in edit mode", () => {
    wrap(<ProviderEditDrawer isOpen onClose={() => {}} provider={PROVIDER_A} />);
    const values = inputValues();
    expect(values).toContain("Alpha Gateway");
    expect(values).toContain("https://alpha.example.com/v1");
    expect(values).toContain("alpha-key");
  });

  it("drops A's DIRTY edits and shows B's values when the prop switches without closing", () => {
    const { rerender } = wrap(
      <ProviderEditDrawer isOpen onClose={() => {}} provider={PROVIDER_A} />,
    );

    // Force the wrong state: dirty A's Name field.
    const nameInput = screen.getByDisplayValue("Alpha Gateway") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "DIRTY NAME" } });
    expect(inputValues()).toContain("DIRTY NAME");

    // Switch entity WITHOUT closing — key flips "prov-a" → "prov-b", the
    // inner form remounts and re-inits from B.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    rerender(
      <QueryClientProvider client={qc}>
        <ProviderEditDrawer isOpen onClose={() => {}} provider={PROVIDER_B} />
      </QueryClientProvider>,
    );

    const values = inputValues();
    // B's values are shown…
    expect(values).toContain("Bravo Gateway");
    expect(values).toContain("https://bravo.example.com/v1");
    expect(values).toContain("bravo-key");
    // …and A's dirt + A's originals are gone.
    expect(values).not.toContain("DIRTY NAME");
    expect(values).not.toContain("Alpha Gateway");
    expect(values).not.toContain("alpha-key");
  });

  it("resets to the empty 'new' form when switching from an entity to create mode", () => {
    const { rerender } = wrap(
      <ProviderEditDrawer isOpen onClose={() => {}} provider={PROVIDER_A} />,
    );
    const nameInput = screen.getByDisplayValue("Alpha Gateway") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "DIRTY NAME" } });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    rerender(
      <QueryClientProvider client={qc}>
        <ProviderEditDrawer isOpen onClose={() => {}} provider={null} />
      </QueryClientProvider>,
    );

    const values = inputValues();
    expect(values).not.toContain("DIRTY NAME");
    expect(values).not.toContain("Alpha Gateway");
    // The empty 'new' form's Name field renders empty.
    expect(values).toContain("");
  });
});
