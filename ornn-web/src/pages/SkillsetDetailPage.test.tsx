/**
 * SkillsetDetailPage — `?version` resolution + all fields render.
 *
 * We mock the data hooks and assert: (a) the `?version` query param is passed
 * to `useSkillset` / `useSkillsetClosure` so a specific version resolves, and
 * (b) the page surfaces name / description / kind / instructions / members /
 * closure / version / visibility for the resolved skillset.
 *
 * The permissions modal + delete flow are exercised in their own test; here we
 * stub the modal to keep the tree light.
 *
 * @module pages/SkillsetDetailPage.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const useSkillset = vi.fn();
const useSkillsetVersions = vi.fn();
const useSkillsetClosure = vi.fn();
const useDeleteSkillset = vi.fn();

vi.mock("@/hooks/useSkillsets", () => ({
  useSkillset: (...a: unknown[]) => useSkillset(...a),
  useSkillsetVersions: (...a: unknown[]) => useSkillsetVersions(...a),
  useSkillsetClosure: (...a: unknown[]) => useSkillsetClosure(...a),
  useDeleteSkillset: (...a: unknown[]) => useDeleteSkillset(...a),
}));

vi.mock("@/stores/authStore", () => ({
  useCurrentUser: () => ({ id: "user-1" }),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}));

// Keep the permissions modal + markdown viewer light.
vi.mock("@/components/skillset/SkillsetPermissionsModal", () => ({
  SkillsetPermissionsModal: () => null,
}));
vi.mock("@/components/skill/ReadmeViewer", () => ({
  ReadmeViewer: ({ content }: { content: string }) => <div data-testid="readme">{content}</div>,
}));
// Stub the Mermaid renderer (heavy in jsdom) so the read-only graph renders a
// marker we can assert on.
// Graph now uses react-flow canvas in read-only (detail). Mock it for the page tests
// that assert on graph rendering/empty states.
vi.mock("@/components/skillset/SkillsetDependencyGraphCanvas", () => ({
  SkillsetDependencyGraphCanvas: ({ edges }: { edges?: unknown[] }) => (
    <div data-testid="depgraph-canvas">
      {(edges || []).length > 0 ? "flowchart" : "No dependencies declared"}
    </div>
  ),
}));
// The member-package viewer fetches each member's skill + package via TanStack
// Query; stub it to a light list so this page test needs no QueryClientProvider.
// Its own behavior is covered in SkillsetMemberViewer.test.
vi.mock("@/components/skillset/SkillsetMemberViewer", () => ({
  SkillsetMemberViewer: ({ members }: { members: string[] }) => (
    <div data-testid="member-viewer">{members.join(" ")}</div>
  ),
}));

import { SkillsetDetailPage } from "./SkillsetDetailPage";
import type { SkillsetDetail } from "@/types/skillset";

const DETAIL: SkillsetDetail = {
  guid: "g-1",
  name: "research-bundle",
  description: "A curated comparison set",
  instructions: "Run A, then B.",
  kind: "consensus-supported",
  tags: ["research"],
  members: ["a@1.0", "b@1.0"],
  version: "1.1",
  latestVersion: "1.1",
  isPrivate: true,
  createdBy: "user-1",
  sharedWithUsers: ["u1"],
  sharedWithOrgs: [],
  createdOn: "2026-06-01T00:00:00.000Z",
  updatedOn: "2026-06-02T00:00:00.000Z",
};

beforeEach(() => {
  useSkillset.mockReturnValue({ data: DETAIL, isLoading: false, error: null });
  useSkillsetVersions.mockReturnValue({ data: [{ version: "1.1" }, { version: "1.0" }] });
  useSkillsetClosure.mockReturnValue({
    data: {
      instructions: "Run A, then B.",
      items: [
        { ref: "a@1.0", name: "a", version: "1.0", depth: 0 },
        { ref: "b@1.0", name: "b", version: "1.0", depth: 0 },
        { ref: "a-dep@2.0", name: "a-dep", version: "2.0", depth: 1 },
      ],
    },
  });
  useDeleteSkillset.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/skillsets/:idOrName" element={<SkillsetDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SkillsetDetailPage", () => {
  it("passes the ?version query param through to the data hooks", () => {
    renderAt("/skillsets/research-bundle?version=1.0");
    expect(useSkillset).toHaveBeenCalledWith("research-bundle", "1.0");
    expect(useSkillsetClosure).toHaveBeenCalledWith("research-bundle", "1.0");
  });

  it("resolves the latest (no version param) when ?version is absent", () => {
    renderAt("/skillsets/research-bundle");
    expect(useSkillset).toHaveBeenCalledWith("research-bundle", undefined);
  });

  it("renders name, description, kind, prompt, members, closure, and visibility", () => {
    renderAt("/skillsets/research-bundle");

    // Name + description.
    expect(screen.getByRole("heading", { name: "research-bundle" })).toBeInTheDocument();
    expect(screen.getByText("A curated comparison set")).toBeInTheDocument();
    // Kind badge (consensus).
    expect(screen.getByText("Consensus")).toBeInTheDocument();
    // Master prompt (rendered via stubbed ReadmeViewer, now in the metadata card).
    expect(screen.getByTestId("readme")).toHaveTextContent("Run A, then B.");
    // Closure (flat list with a depth-1 dependency).
    expect(screen.getByTestId("closure-list")).toHaveTextContent("a-dep");
    // Visibility card (exact same as skill details) — shows user/org counts.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/users/i)).toBeInTheDocument();
  });

  it("shows owner actions (Edit + Delete) for the author", () => {
    renderAt("/skillsets/research-bundle");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete skillset" })).toBeInTheDocument();
  });

  it("renders the not-found state when the skillset is missing", () => {
    useSkillset.mockReturnValue({ data: undefined, isLoading: false, error: new Error("404") });
    renderAt("/skillsets/missing");
    expect(screen.getByText("Skillset not found")).toBeInTheDocument();
  });

  it("shows the read-only dependency graph when the prompt carries a deps block", () => {
    useSkillset.mockReturnValue({
      data: {
        ...DETAIL,
        instructions: [
          "Run A, then B.",
          "",
          "<!-- ornn:deps:start -->",
          "```mermaid",
          "flowchart TD",
          '  n0["a@1.0"] --> n1["b@1.0"]',
          "```",
          "<!-- ornn:deps:end -->",
        ].join("\n"),
      },
      isLoading: false,
      error: null,
    });
    renderAt("/skillsets/research-bundle");
    expect(screen.getByText("Member dependencies")).toBeInTheDocument();
    // Graph (canvas) is present when there is a deps block (no empty state).
    expect(screen.queryByText(/No dependencies declared/)).not.toBeInTheDocument();
  });

  it("shows the empty graph state when the prompt has no deps block", () => {
    // DETAIL.instructions has no managed block → empty-deps state, no mermaid.
    renderAt("/skillsets/research-bundle");
    expect(screen.getByText("Member dependencies")).toBeInTheDocument();
    expect(screen.getByText(/No dependencies declared/)).toBeInTheDocument();
  });
});
