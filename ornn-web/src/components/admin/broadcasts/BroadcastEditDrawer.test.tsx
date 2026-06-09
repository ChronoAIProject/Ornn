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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

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

// Avoid pulling in apiClient via UserEmailPicker → adminUsersApi.
vi.mock("@/services/adminUsersApi", () => ({
  fetchAdminUsers: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 0,
    totalPages: 1,
  }),
}));

// Stub the recipient picker so the "specific audience" path can be
// driven deterministically — a single button that pushes one userId
// through `onChange`, no debounced search or network.
vi.mock("@/components/admin/UserEmailPicker", () => ({
  UserEmailPicker: ({
    value,
    onChange,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid="add-recipient"
      onClick={() => onChange([...value, "user-1"])}
    >
      add recipient ({value.length})
    </button>
  ),
}));

import type { AdminBroadcast } from "@/services/broadcastsApi";
import { BroadcastEditDrawer } from "./BroadcastEditDrawer";

const EDIT_BROADCAST: AdminBroadcast = {
  id: "bc-123",
  titleI18n: { en: "Existing title", zh: "现有标题" },
  bodyMarkdownI18n: { en: "Existing body", zh: "现有正文" },
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  createdBy: "admin-1",
  updatedBy: "admin-1",
  readCount: 0,
  recipientUserIds: ["user-1", "user-2"],
};

const EDIT_BROADCAST_B: AdminBroadcast = {
  id: "bc-456",
  titleI18n: { en: "Second title", zh: "第二标题" },
  bodyMarkdownI18n: { en: "Second body", zh: "第二正文" },
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
  createdBy: "admin-1",
  updatedBy: "admin-1",
  readCount: 0,
  recipientUserIds: null,
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

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

    wrap(
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
    wrap(
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

  it("blocks submit when 'Specific users' is selected with no recipients", async () => {
    wrap(
      <BroadcastEditDrawer
        isOpen={true}
        onClose={() => {}}
        broadcast={null}
      />,
    );

    fillBilingual({
      titleEn: "Targeted",
      titleZh: "定向",
      bodyEn: "Hello",
      bodyZh: "你好",
    });

    // Flip to "Specific users" but add no recipients.
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const specificRadio = radios.find((r) =>
      (r.parentElement?.textContent ?? "").toLowerCase().includes("specific"),
    );
    expect(specificRadio).toBeTruthy();
    fireEvent.click(specificRadio!);

    const buttons = screen.getAllByRole("button");
    const submitBtn = buttons.find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    expect(createMutate).not.toHaveBeenCalled();
  });

  it.each([
    ["titleEn", { titleEn: "", titleZh: "标题", bodyEn: "Body", bodyZh: "正文" }],
    ["titleZh", { titleEn: "Title", titleZh: "", bodyEn: "Body", bodyZh: "正文" }],
    ["bodyEn", { titleEn: "Title", titleZh: "标题", bodyEn: "", bodyZh: "正文" }],
    ["bodyZh", { titleEn: "Title", titleZh: "标题", bodyEn: "Body", bodyZh: "" }],
  ] as const)(
    "blocks submit when the %s field is empty",
    async (_field, values) => {
      wrap(
        <BroadcastEditDrawer isOpen onClose={() => {}} broadcast={null} />,
      );
      fillBilingual(values);

      const submitBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("type") === "submit");
      fireEvent.click(submitBtn!);

      expect(createMutate).not.toHaveBeenCalled();
    },
  );

  it("blocks submit when a title exceeds the 200-char cap", async () => {
    wrap(<BroadcastEditDrawer isOpen onClose={() => {}} broadcast={null} />);
    // jsdom doesn't enforce <input maxLength> on programmatic value=,
    // so we can push a string past TITLE_MAX (200) to trip the cap rule.
    fillBilingual({
      titleEn: "a".repeat(201),
      titleZh: "标题",
      bodyEn: "Body",
      bodyZh: "正文",
    });

    const submitBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    expect(createMutate).not.toHaveBeenCalled();
  });

  it("blocks submit when a body exceeds the 20k-char cap", async () => {
    wrap(<BroadcastEditDrawer isOpen onClose={() => {}} broadcast={null} />);
    fillBilingual({
      titleEn: "Title",
      titleZh: "标题",
      bodyEn: "a".repeat(20_001),
      bodyZh: "正文",
    });

    const submitBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    expect(createMutate).not.toHaveBeenCalled();
  });

  it("carries recipientUserIds in the payload for a specific audience", async () => {
    createMutate.mockImplementation(
      (_input: unknown, opts: { onSuccess?: () => void } = {}) => {
        opts.onSuccess?.();
      },
    );

    wrap(<BroadcastEditDrawer isOpen onClose={() => {}} broadcast={null} />);

    fillBilingual({
      titleEn: "Targeted",
      titleZh: "定向",
      bodyEn: "Hello",
      bodyZh: "你好",
    });

    // Flip to "Specific users" and add a recipient via the stubbed picker.
    const specificRadio = (screen.getAllByRole("radio") as HTMLInputElement[]).find(
      (r) => (r.parentElement?.textContent ?? "").toLowerCase().includes("specific"),
    );
    fireEvent.click(specificRadio!);
    fireEvent.click(screen.getByTestId("add-recipient"));

    const submitBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const [payload] = createMutate.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({ recipientUserIds: ["user-1"] }),
    );
  });

  it("keeps the drawer open and toasts on a create error", async () => {
    const onClose = vi.fn();
    createMutate.mockImplementation(
      (_input: unknown, opts: { onError?: (e: unknown) => void } = {}) => {
        opts.onError?.(new Error("boom"));
      },
    );

    wrap(<BroadcastEditDrawer isOpen onClose={onClose} broadcast={null} />);
    fillBilingual({
      titleEn: "Title",
      titleZh: "标题",
      bodyEn: "Body",
      bodyZh: "正文",
    });

    const submitBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      ),
    );
    // The error branch never calls onClose — the drawer stays open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the drawer when Escape is pressed", () => {
    const onClose = vi.fn();
    wrap(<BroadcastEditDrawer isOpen onClose={onClose} broadcast={null} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("BroadcastEditDrawer — edit mode", () => {
  it("prefills the form from the broadcast prop", () => {
    wrap(
      <BroadcastEditDrawer
        isOpen
        onClose={() => {}}
        broadcast={EDIT_BROADCAST}
      />,
    );

    const textboxes = screen.getAllByRole("textbox") as HTMLInputElement[];
    const values = textboxes.map((el) => el.value);
    expect(values).toContain("Existing title");
    expect(values).toContain("现有标题");
    expect(values).toContain("Existing body");
    expect(values).toContain("现有正文");
  });

  it("submits an update with recipientUserIds stripped from the patch", async () => {
    updateMutate.mockImplementation(
      (_args: unknown, opts: { onSuccess?: () => void } = {}) => {
        opts.onSuccess?.();
      },
    );
    const onClose = vi.fn();

    wrap(
      <BroadcastEditDrawer
        isOpen
        onClose={onClose}
        broadcast={EDIT_BROADCAST}
      />,
    );

    const submitBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const [args] = updateMutate.mock.calls[0];
    expect(args.id).toBe("bc-123");
    // PATCH carries title + body only — recipientUserIds must be absent.
    expect(args.patch).not.toHaveProperty("recipientUserIds");
    expect(args.patch).toEqual({
      titleI18n: { en: "Existing title", zh: "现有标题" },
      bodyMarkdownI18n: { en: "Existing body", zh: "现有正文" },
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("resets the form when the open drawer switches to another broadcast", () => {
    // Pins the `key={broadcast?.id ?? "new"}` remount on BroadcastEditForm
    // (#888). The drawer never closes between the two broadcasts — only the
    // `broadcast` prop changes — so without the key the lazy-initialised
    // form state would survive and keep showing broadcast A's values.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <BroadcastEditDrawer isOpen onClose={() => {}} broadcast={EDIT_BROADCAST} />
      </QueryClientProvider>,
    );

    const valuesA = (screen.getAllByRole("textbox") as HTMLInputElement[]).map(
      (el) => el.value,
    );
    expect(valuesA).toContain("Existing title");
    expect(valuesA).toContain("现有标题");

    // Switch entity WITHOUT closing the drawer (isOpen stays true). The
    // rerender keeps the same provider so the inner useQuery still resolves.
    rerender(
      <QueryClientProvider client={qc}>
        <BroadcastEditDrawer isOpen onClose={() => {}} broadcast={EDIT_BROADCAST_B} />
      </QueryClientProvider>,
    );

    const valuesB = (screen.getAllByRole("textbox") as HTMLInputElement[]).map(
      (el) => el.value,
    );
    // B's values are shown…
    expect(valuesB).toContain("Second title");
    expect(valuesB).toContain("第二标题");
    expect(valuesB).toContain("Second body");
    expect(valuesB).toContain("第二正文");
    // …and A's stale values are gone (the remount discarded them).
    expect(valuesB).not.toContain("Existing title");
    expect(valuesB).not.toContain("现有标题");
  });
});
