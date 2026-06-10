/**
 * SkillsetCard — renders identity + kind/visibility, NEVER a member count.
 *
 * The load-bearing assertion (#969 / #1059): the browse card must not surface
 * a member count, because `SkillsetSearchItem.memberCount` is hardcoded `0` in
 * the backend search service. The test passes a result with `memberCount: 0`
 * and asserts the card neither shows that count nor a "members" label.
 *
 * Owner controls (Edit / Delete) only render for the author when explicitly
 * enabled, and clicking them does NOT navigate (stopPropagation).
 *
 * @module components/skillset/SkillsetCard.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

import { SkillsetCard } from "./SkillsetCard";
import type { SkillsetSearchItem } from "@/types/skillset";

const ITEM: SkillsetSearchItem = {
  guid: "g-1",
  name: "research-bundle",
  description: "A curated comparison set",
  kind: "consensus-supported",
  tags: ["research", "rag"],
  memberCount: 0,
  latestVersion: "1.2",
  isPrivate: false,
  createdBy: "user-1",
  createdByDisplayName: "Ada",
  createdOn: "2026-06-01T00:00:00.000Z",
  updatedOn: "2026-06-02T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(props: Partial<Parameters<typeof SkillsetCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SkillsetCard skillset={ITEM} {...props} />
    </MemoryRouter>,
  );
}

describe("SkillsetCard", () => {
  it("renders the name, kind, visibility, version, tags, and author", () => {
    renderCard();
    expect(screen.getByText("research-bundle")).toBeInTheDocument();
    expect(screen.getByText("Consensus")).toBeInTheDocument();
    expect(screen.getByText(/Public/)).toBeInTheDocument();
    expect(screen.getByText("v1.2")).toBeInTheDocument();
    expect(screen.getByText("research")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("never surfaces a member count (memberCount is 0 from search)", () => {
    renderCard();
    // No "0 members", no "member" label, no bare "0" count chip anywhere.
    expect(screen.queryByText(/member/i)).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("navigates to the detail page by name on card click", () => {
    renderCard();
    fireEvent.click(screen.getByText("research-bundle"));
    expect(navigateSpy).toHaveBeenCalledWith("/skillsets/research-bundle");
  });

  it("shows owner Edit/Delete only when enabled for the author, and they don't navigate", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderCard({
      showOwnerControls: true,
      currentUserId: "user-1",
      onEdit,
      onDelete,
    });
    const editBtn = screen.getByRole("button", { name: "Edit" });
    const deleteBtn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(editBtn);
    fireEvent.click(deleteBtn);
    expect(onEdit).toHaveBeenCalledWith(ITEM);
    expect(onDelete).toHaveBeenCalledWith(ITEM);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("hides owner controls for a non-author even when enabled", () => {
    renderCard({ showOwnerControls: true, currentUserId: "someone-else", onDelete: vi.fn() });
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
