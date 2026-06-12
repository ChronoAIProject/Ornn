/**
 * ModelPicker tests — activeIndex re-seed/clear guard (#888).
 *
 * The highlighted option (`activeIndex`) is seeded during render whenever
 * the menu toggles open (to the currently-selected model's position) and
 * cleared to -1 on close. Because the seed reads `options` + the resolved
 * `effectiveModelId` at the moment the menu opens, a model that MOVED or
 * DISAPPEARED across a list change must not leave a stale index behind —
 * the next open re-seeds against the fresh list.
 *
 * STALE-STATE-FIRST oracle: open the menu against list A (seeds the active
 * row to the selected model at index N), close, swap to list B where the
 * selected model now sits at a DIFFERENT index, reopen → the highlighted
 * row tracks the model's NEW position, not the stale N.
 *
 * `usePreferredModel` is mocked so the test controls `options` +
 * `effectiveModelId` directly without the apiClient / auth / localStorage
 * chain. react-i18next is stubbed globally in src/test/setup.ts.
 *
 * @module components/models/ModelPicker.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PickerModel } from "@/services/modelsApi";

const usePreferredModel = vi.fn();
const setPreferred = vi.fn();

vi.mock("@/hooks/useModels", () => ({
  usePreferredModel: (surface: string) => usePreferredModel(surface),
}));

import { ModelPicker } from "./ModelPicker";

function model(id: string, displayName: string, isDefault = false): PickerModel {
  return { modelId: id, displayName, isDefault };
}

/** Default mock return — three models, "beta" selected. */
function seed(options: PickerModel[], effectiveModelId: string | null) {
  usePreferredModel.mockReturnValue({
    options,
    effectiveModelId,
    setPreferred,
    storedModelId: effectiveModelId,
    defaultModelId: options[0]?.modelId ?? null,
    isLoading: false,
    isEmpty: options.length === 0,
  });
}

/**
 * The currently-highlighted (activeIndex) option carries the exact
 * `bg-elevated text-strong` active class. Note the inactive rows carry
 * `hover:bg-elevated/70`, so we must match the unprefixed active fragment
 * rather than a loose `bg-elevated` substring.
 */
function activeOptionLabel(): string | null {
  const opts = screen.queryAllByRole("option");
  const active = opts.find((o) => /(?:^|\s)bg-elevated(?:\s|$)/.test(o.className));
  return active ? (active.textContent ?? "").trim() : null;
}

beforeEach(() => {
  usePreferredModel.mockReset();
  setPreferred.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ModelPicker — activeIndex seed/reset on toggle", () => {
  it("seeds the active row to the selected model when the menu opens, clears on close", () => {
    const opts = [model("alpha", "Alpha"), model("beta", "Beta"), model("gamma", "Gamma")];
    seed(opts, "beta");
    render(<ModelPicker surface="playground" />);

    // Closed → no listbox rendered.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Open → the active row is the SELECTED model (Beta), not the first.
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(activeOptionLabel()).toBe("Beta");

    // Close → menu unmounts, activeIndex cleared to -1 (no active row).
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("re-seeds against the fresh list on reopen when the selected model MOVED", () => {
    // List A: Beta selected at index 1.
    const listA = [model("alpha", "Alpha"), model("beta", "Beta"), model("gamma", "Gamma")];
    seed(listA, "beta");
    const { rerender } = render(<ModelPicker surface="playground" />);

    // Open against list A — active row seeds to index 1 (Beta).
    fireEvent.click(screen.getByRole("button"));
    expect(activeOptionLabel()).toBe("Beta");
    // Close so the next open triggers a fresh render-time re-seed.
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // List B: the SAME selected model (Beta) is now at index 0 — a model
    // ahead of it was dropped, so the prior index 1 is now stale.
    const listB = [model("beta", "Beta"), model("gamma", "Gamma")];
    seed(listB, "beta");
    rerender(<ModelPicker surface="playground" />);

    // Reopen — the seed must track Beta's NEW position (index 0), not the
    // stale index 1 (which would highlight Gamma).
    fireEvent.click(screen.getByRole("button"));
    expect(activeOptionLabel()).toBe("Beta");
    expect(activeOptionLabel()).not.toBe("Gamma");
  });

  it("seeds to the first row when the selected model DISAPPEARED from the list", () => {
    // List A: Gamma selected at index 2.
    const listA = [model("alpha", "Alpha"), model("beta", "Beta"), model("gamma", "Gamma")];
    seed(listA, "gamma");
    const { rerender } = render(<ModelPicker surface="playground" />);

    fireEvent.click(screen.getByRole("button"));
    expect(activeOptionLabel()).toBe("Gamma");
    fireEvent.click(screen.getByRole("button"));

    // List B drops Gamma; the resolver falls back to the default (Alpha).
    const listB = [model("alpha", "Alpha"), model("beta", "Beta")];
    seed(listB, "alpha");
    rerender(<ModelPicker surface="playground" />);

    fireEvent.click(screen.getByRole("button"));
    // findIndex of the (now-default) selected model resolves to index 0 →
    // first row active; never a stale index 2 (which is out of bounds).
    expect(activeOptionLabel()).toBe("Alpha");
  });

  it("marks the selected option via aria-selected even after the list changes", () => {
    const listA = [model("alpha", "Alpha"), model("beta", "Beta")];
    seed(listA, "beta");
    const { rerender } = render(<ModelPicker surface="playground" />);

    fireEvent.click(screen.getByRole("button"));
    const listbox1 = screen.getByRole("listbox");
    const selected1 = within(listbox1)
      .getAllByRole("option")
      .find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected1?.textContent).toContain("Beta");
    fireEvent.click(screen.getByRole("button"));

    // Swap to a list where alpha is now selected.
    const listB = [model("alpha", "Alpha"), model("beta", "Beta")];
    seed(listB, "alpha");
    rerender(<ModelPicker surface="playground" />);

    fireEvent.click(screen.getByRole("button"));
    const listbox2 = screen.getByRole("listbox");
    const selected2 = within(listbox2)
      .getAllByRole("option")
      .find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected2?.textContent).toContain("Alpha");
  });
});
