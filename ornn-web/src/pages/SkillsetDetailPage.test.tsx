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
    // Master prompt (rendered via stubbed ReadmeViewer).
    expect(screen.getByTestId("readme")).toHaveTextContent("Run A, then B.");
    // Members — both a@1.0 and b@1.0 render their @version chip.
    expect(screen.getAllByText("a").length).toBeGreaterThan(0);
    expect(screen.getAllByText("@1.0").length).toBeGreaterThan(0);
    // Closure (flat list with a depth-1 dependency).
    expect(screen.getByTestId("closure-list")).toHaveTextContent("a-dep");
    // Visibility — private, with the shared-with count.
    expect(screen.getByText(/Shared with 1 users/)).toBeInTheDocument();
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
});
