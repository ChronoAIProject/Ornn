/**
 * AnnouncementEditDrawer tests — entity-switch reset via key remount (#888).
 *
 * The inner form is keyed on `announcement?.id ?? "new"` so its
 * lazy-initialised state resets by construction when the open drawer
 * switches from announcement A to announcement B without closing. Without
 * the key, A's edited (dirty) state would survive and bleed into B.
 *
 * STALE-STATE-FIRST oracle: open on A, DIRTY a field (type new text), then
 * switch the `announcement` prop to B while the drawer stays open →
 * B's values render and A's dirt is gone (the remount discarded it).
 *
 * Mocks the mutation hooks + toast store directly so the test doesn't pull
 * in the apiClient / auth store init chain. framer-motion is stubbed
 * pass-through so the slide AnimatePresence doesn't gate mount/unmount.
 * react-i18next is stubbed globally in src/test/setup.ts.
 *
 * @module components/admin/announcements/AnnouncementEditDrawer.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AdminAnnouncement } from "@/services/announcementsApi";

const createMutate = vi.fn();
const updateMutate = vi.fn();
const useCreateAnnouncement = vi.fn();
const useUpdateAnnouncement = vi.fn();
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

vi.mock("@/hooks/useAnnouncements", () => ({
  useCreateAnnouncement: () => useCreateAnnouncement(),
  useUpdateAnnouncement: () => useUpdateAnnouncement(),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

import { AnnouncementEditDrawer } from "./AnnouncementEditDrawer";

const ANNOUNCEMENT_A: AdminAnnouncement = {
  id: "a-1",
  titleEn: "Alpha title",
  titleZh: "阿尔法标题",
  bodyMarkdownEn: "Alpha body",
  bodyMarkdownZh: "阿尔法正文",
  ctaLabelEn: null,
  ctaLabelZh: null,
  ctaUrl: null,
  enabled: true,
  startsAt: null,
  endsAt: null,
  createdBy: "admin-1",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const ANNOUNCEMENT_B: AdminAnnouncement = {
  id: "b-2",
  titleEn: "Bravo title",
  titleZh: "布拉沃标题",
  bodyMarkdownEn: "Bravo body",
  bodyMarkdownZh: "布拉沃正文",
  ctaLabelEn: null,
  ctaLabelZh: null,
  ctaUrl: null,
  enabled: false,
  startsAt: null,
  endsAt: null,
  createdBy: "admin-1",
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
};

function inputValues(): string[] {
  return (screen.getAllByRole("textbox") as HTMLInputElement[]).map((el) => el.value);
}

/** Locate the "Title (EN)" input by its label text via the Input primitive. */
function titleEnInput(): HTMLInputElement {
  return screen.getByDisplayValue("Alpha title") as HTMLInputElement;
}

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
  addToast.mockReset();
  useCreateAnnouncement.mockReturnValue({ mutate: createMutate, isPending: false });
  useUpdateAnnouncement.mockReturnValue({ mutate: updateMutate, isPending: false });
});

afterEach(() => {
  cleanup();
});

describe("AnnouncementEditDrawer — entity-switch reset", () => {
  it("prefills the form from the announcement prop in edit mode", () => {
    render(
      <AnnouncementEditDrawer
        isOpen
        onClose={() => {}}
        announcement={ANNOUNCEMENT_A}
      />,
    );
    const values = inputValues();
    expect(values).toContain("Alpha title");
    expect(values).toContain("阿尔法标题");
  });

  it("drops A's DIRTY edits and shows B's values when the prop switches without closing", () => {
    const { rerender } = render(
      <AnnouncementEditDrawer
        isOpen
        onClose={() => {}}
        announcement={ANNOUNCEMENT_A}
      />,
    );

    // Force the wrong state: dirty A's title field with a value that matches
    // neither A nor B's original.
    fireEvent.change(titleEnInput(), { target: { value: "DIRTY EDIT" } });
    expect(inputValues()).toContain("DIRTY EDIT");

    // Switch entity WITHOUT closing (isOpen stays true). The key flips from
    // "a-1" to "b-2" → the inner form remounts and re-inits from B.
    rerender(
      <AnnouncementEditDrawer
        isOpen
        onClose={() => {}}
        announcement={ANNOUNCEMENT_B}
      />,
    );

    const values = inputValues();
    // B's values are shown…
    expect(values).toContain("Bravo title");
    expect(values).toContain("布拉沃标题");
    // …and A's dirt + A's originals are gone (the remount discarded them).
    expect(values).not.toContain("DIRTY EDIT");
    expect(values).not.toContain("Alpha title");
  });

  it("resets to the empty 'new' form when switching from an entity to create mode", () => {
    const { rerender } = render(
      <AnnouncementEditDrawer
        isOpen
        onClose={() => {}}
        announcement={ANNOUNCEMENT_A}
      />,
    );
    fireEvent.change(titleEnInput(), { target: { value: "DIRTY EDIT" } });

    // Switch to create mode (announcement = null → key "new").
    rerender(
      <AnnouncementEditDrawer isOpen onClose={() => {}} announcement={null} />,
    );

    const values = inputValues();
    expect(values).not.toContain("DIRTY EDIT");
    expect(values).not.toContain("Alpha title");
    // The empty form's title input renders as an empty string.
    expect(values).toContain("");
  });
});
