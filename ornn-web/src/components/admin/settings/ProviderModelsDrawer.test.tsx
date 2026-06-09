/**
 * ProviderModelsDrawer — assistant surface column (#970).
 *
 * The drawer gained a fourth surface column (Assistant) alongside
 * Playground and Skill-Gen. This guards that the assistant Toggle/Radio
 * render and PATCH the right flag, so the admin can target the Ornn
 * Assistant surface exactly like the other two.
 *
 * framer-motion is stubbed pass-through; the toast store + settings API
 * are mocked so no network / localStorage init chain runs. The drawer's
 * patch mutation is built inline with useMutation, so the component is
 * wrapped in a QueryClientProvider.
 *
 * @module components/admin/settings/ProviderModelsDrawer.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { LlmProvider } from "@/services/settingsApi";

const addToast = vi.fn();
const patchProviderModelFlags = vi.fn();

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

vi.mock("@/services/settingsApi", () => ({
  patchProviderModelFlags: (...args: unknown[]) => patchProviderModelFlags(...args),
}));

import { ProviderModelsDrawer } from "./ProviderModelsDrawer";

const PROVIDER: LlmProvider = {
  _id: "prov-1",
  name: "Alpha Gateway",
  gatewayUrl: "https://alpha.example.com/v1",
  modelListUrl: "https://alpha.example.com/v1/models",
  apiFormat: "chat-completion",
  auth: { kind: "apiKey", apiKey: "k" },
  maxOutputTokens: 4096,
  defaultTemperature: 0.7,
  models: [
    {
      id: "gpt-5",
      displayName: "GPT-5",
      enabledForPlayground: true,
      enabledForSkillGen: false,
      enabledForAssistant: false,
      defaultForPlayground: false,
      defaultForSkillGen: false,
      defaultForAssistant: false,
      removed: false,
    },
  ],
};

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProviderModelsDrawer isOpen onClose={() => {}} provider={PROVIDER} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  addToast.mockReset();
  patchProviderModelFlags.mockReset();
  patchProviderModelFlags.mockResolvedValue(PROVIDER);
});

afterEach(cleanup);

describe("ProviderModelsDrawer — assistant column", () => {
  it("renders the Assistant column header", () => {
    renderDrawer();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });

  it("renders the assistant enable toggle + default radio for a model", () => {
    renderDrawer();
    expect(screen.getByLabelText("Enabled for assistant")).toBeInTheDocument();
    expect(screen.getByLabelText("Default for assistant")).toBeInTheDocument();
  });

  it("PATCHes enabledForAssistant when the assistant toggle is flipped", async () => {
    renderDrawer();
    fireEvent.click(screen.getByLabelText("Enabled for assistant"));
    await waitFor(() =>
      expect(patchProviderModelFlags).toHaveBeenCalledWith("prov-1", "gpt-5", {
        enabledForAssistant: true,
      }),
    );
  });

  it("PATCHes defaultForAssistant when the assistant default radio is selected", async () => {
    renderDrawer();
    fireEvent.click(screen.getByLabelText("Default for assistant"));
    await waitFor(() =>
      expect(patchProviderModelFlags).toHaveBeenCalledWith("prov-1", "gpt-5", {
        defaultForAssistant: true,
      }),
    );
  });
});
