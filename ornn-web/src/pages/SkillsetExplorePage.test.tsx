/**
 * SkillsetExplorePage — tab switch + filters drive the per-scope queries.
 *
 * No member-count assertion (search returns 0 — see SkillsetCard.test). We
 * mock the three list hooks and assert: (a) the active scope's hook is the one
 * whose results render, (b) switching tabs via the tab buttons rewrites the
 * `?scope` URL param, and (c) the kind filter passes through to the hook.
 *
 * #1067 — the page now wears the shared registry shell: a `RegistrySidebar`
 * aside (Kind chip section + Tags input) and a `RegistryGrid` body. It mounts
 * NO keyword `SearchBar` because the skillset-search backend has no `q` param.
 *
 * @module pages/SkillsetExplorePage.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const publicHook = vi.fn();
const mineHook = vi.fn();
const sharedHook = vi.fn();

vi.mock("@/hooks/useSkillsets", () => ({
  usePublicSkillsets: (p: unknown) => publicHook(p),
  useMySkillsets: (p: unknown) => mineHook(p),
  useSharedWithMeSkillsets: (p: unknown) => sharedHook(p),
}));

vi.mock("@/stores/authStore", () => ({
  useIsAuthenticated: () => true,
  useCurrentUser: () => ({ id: "user-1" }),
}));

import { SkillsetExplorePage } from "./SkillsetExplorePage";
import type { SkillsetSearchItem } from "@/types/skillset";

function makeItem(name: string): SkillsetSearchItem {
  return {
    guid: `g-${name}`,
    name,
    description: "d",
    kind: "generic",
    tags: [],
    memberCount: 0,
    latestVersion: "1.0",
    isPrivate: false,
    createdBy: "user-1",
    createdOn: "2026-06-01T00:00:00.000Z",
    updatedOn: "2026-06-01T00:00:00.000Z",
  };
}

function result(items: SkillsetSearchItem[]) {
  return {
    data: { items, total: items.length, page: 1, pageSize: 20, totalPages: 1 },
    isLoading: false,
  };
}

beforeEach(() => {
  publicHook.mockReturnValue(result([makeItem("public-set")]));
  mineHook.mockReturnValue(result([makeItem("mine-set")]));
  sharedHook.mockReturnValue(result([makeItem("shared-set")]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SkillsetExplorePage />
    </MemoryRouter>,
  );
}

describe("SkillsetExplorePage tabs + filters", () => {
  it("defaults to the public scope and renders public results", () => {
    renderAt("/skillsets");
    expect(screen.getByText("public-set")).toBeInTheDocument();
    expect(screen.queryByText("mine-set")).not.toBeInTheDocument();
    // The active scope's hook is enabled; the inactive ones are disabled.
    expect(publicHook).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(mineHook).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("reads the mine scope from ?scope=mine and renders mine results", () => {
    renderAt("/skillsets?scope=mine");
    expect(screen.getByText("mine-set")).toBeInTheDocument();
    expect(mineHook).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it("switches scope when a tab button is clicked", () => {
    renderAt("/skillsets");
    fireEvent.click(screen.getByRole("button", { name: "Shared with me" }));
    // After the click, the shared hook becomes the enabled one.
    expect(sharedHook).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    expect(screen.getByText("shared-set")).toBeInTheDocument();
  });

  it("passes the kind filter from ?kind through to the active hook", () => {
    renderAt("/skillsets?kind=consensus-supported");
    expect(publicHook).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "consensus-supported" }),
    );
  });

  it("passes tag filters from ?tags through to the active hook", () => {
    renderAt("/skillsets?tags=research,rag");
    expect(publicHook).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["research", "rag"] }),
    );
  });

  it("renders the Kind + Tags sidebar sections", () => {
    renderAt("/skillsets");
    expect(screen.getByRole("heading", { name: "Kind" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tags" })).toBeInTheDocument();
    // Kind chips for All / Bundle / Consensus.
    expect(screen.getByRole("button", { name: "All kinds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bundle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Consensus" })).toBeInTheDocument();
    // Two text fields: the keyword search box + the tag input.
    expect(
      screen.getByPlaceholderText("Search skillsets by name or description..."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("add tag…")).toBeInTheDocument();
  });

  it("toggles the kind filter via the sidebar chip and updates the URL/hook", () => {
    renderAt("/skillsets");
    fireEvent.click(screen.getByRole("button", { name: "Consensus" }));
    expect(publicHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "consensus-supported" }),
    );
  });

  it("adds a tag from the sidebar input and passes it to the active hook", () => {
    renderAt("/skillsets");
    const input = screen.getByPlaceholderText("add tag…");
    fireEvent.change(input, { target: { value: "research" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(publicHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: ["research"] }),
    );
  });

  it("passes the keyword search box value to the active hook as q", () => {
    renderAt("/skillsets");
    const search = screen.getByPlaceholderText(
      "Search skillsets by name or description...",
    );
    fireEvent.change(search, { target: { value: "rag" } });
    expect(publicHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "rag" }),
    );
  });

  it("renders the grid cards for the active scope", () => {
    renderAt("/skillsets");
    expect(screen.getByText("public-set")).toBeInTheDocument();
  });

  it("respects a pinned scope and hides the tab strip (My Skillsets wrapper)", () => {
    render(
      <MemoryRouter initialEntries={["/my-skillsets"]}>
        <SkillsetExplorePage pinScope="mine" />
      </MemoryRouter>,
    );
    expect(screen.getByText("mine-set")).toBeInTheDocument();
    // No "Public Skillsets" tab button when pinned.
    expect(screen.queryByRole("button", { name: "Public Skillsets" })).not.toBeInTheDocument();
    expect(mineHook).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
});
