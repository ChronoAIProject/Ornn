/**
 * BroadcastEditDrawer tests — happy-path create flow.
 *
 * Verifies that the drawer in create mode:
 *   - rejects submission when either locale is empty (titles + bodies),
 *   - calls `useCreateBroadcast` with the trimmed bilingual payload
 *     when both locales are filled,
 *   - fires a success toast and closes on resolution.
 *
 * Mocks the mutation hooks + toast store directly so the test doesn't
 * pull in the apiClient / auth store init chain.
 *
 * @module components/admin/broadcasts/BroadcastEditDrawer.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const createMutate = vi.fn();
const updateMutate = vi.fn();
const useCreateBroadcast = vi.fn();
const useUpdateBroadcast = vi.fn();
const addToast = vi.fn();

vi.mock("@/hooks/useBroadcasts", () => ({
  useCreateBroadcast: () => useCreateBroadcast(),
  useUpdateBroadcast: () => useUpdateBroadcast(),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

import { BroadcastEditDrawer } from "./BroadcastEditDrawer";

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
  addToast.mockReset();
  useCreateBroadcast.mockReturnValue({
    mutate: createMutate,
    isPending: false,
  });
  useUpdateBroadcast.mockReturnValue({
    mutate: updateMutate,
    isPending: false,
  });
});

afterEach(() => {
  cleanup();
});

function fillBilingual(values: {
  titleEn: string;
  titleZh: string;
  bodyEn: string;
  bodyZh: string;
}) {
  // The drawer uses two Input components and two MarkdownEditor textareas.
  // Inputs render <label> + <input>; MarkdownEditor renders <label> +
  // <textarea> (inside its toolbar wrapper).
  const titleInputs = screen.getAllByRole("textbox") as HTMLInputElement[];
  // Order: titleEn input, bodyEn textarea, titleZh input, bodyZh textarea.
  // jsdom returns these in DOM order which matches the drawer's section order.
  const [titleEnEl, bodyEnEl, titleZhEl, bodyZhEl] = titleInputs;
  fireEvent.change(titleEnEl, { target: { value: values.titleEn } });
  fireEvent.change(bodyEnEl, { target: { value: values.bodyEn } });
  fireEvent.change(titleZhEl, { target: { value: values.titleZh } });
  fireEvent.change(bodyZhEl, { target: { value: values.bodyZh } });
}

describe("BroadcastEditDrawer", () => {
  it("creates a broadcast with bilingual payload on submit", async () => {
    const onClose = vi.fn();
    createMutate.mockImplementation(
      (_input: unknown, opts: { onSuccess?: () => void } = {}) => {
        opts.onSuccess?.();
      },
    );

    render(
      <BroadcastEditDrawer
        isOpen={true}
        onClose={onClose}
        broadcast={null}
      />,
    );

    fillBilingual({
      titleEn: "Maintenance window",
      titleZh: "维护窗口",
      bodyEn: "We will restart **ornn-api** at 02:00 UTC.",
      bodyZh: "我们将于 UTC 02:00 重启 **ornn-api**。",
    });

    // Submit — the drawer's primary button is `type="submit"`. There are
    // two buttons in the footer (cancel + submit); the submit one is last.
    const buttons = screen.getAllByRole("button");
    const submitBtn = buttons.find((b) => b.getAttribute("type") === "submit");
    expect(submitBtn).toBeTruthy();
    fireEvent.click(submitBtn!);

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const [payload] = createMutate.mock.calls[0];
    expect(payload).toEqual({
      titleI18n: { en: "Maintenance window", zh: "维护窗口" },
      bodyMarkdownI18n: {
        en: "We will restart **ornn-api** at 02:00 UTC.",
        zh: "我们将于 UTC 02:00 重启 **ornn-api**。",
      },
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("does not submit when one of the four required fields is empty", async () => {
    render(
      <BroadcastEditDrawer
        isOpen={true}
        onClose={() => {}}
        broadcast={null}
      />,
    );

    // Only fill EN — leave both ZH fields empty.
    fillBilingual({
      titleEn: "Maintenance window",
      titleZh: "",
      bodyEn: "Restart at 02:00 UTC.",
      bodyZh: "",
    });

    const buttons = screen.getAllByRole("button");
    const submitBtn = buttons.find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    // Mutation never fires; the drawer remains open (onClose isn't
    // called from a failed submission path).
    expect(createMutate).not.toHaveBeenCalled();
  });
});
