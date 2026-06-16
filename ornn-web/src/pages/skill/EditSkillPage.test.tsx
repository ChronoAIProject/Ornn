/**
 * EditSkillPage regression tests.
 *
 * Locks in the contract that owner write mutations
 * (`useUpdateSkill`, `useUpdateSkillPackage`) receive the skill's
 * GUID, never the URL `:id` (which is the human-readable name).
 *
 * Why this matters (#565): PR #586 tightened backend resolution on
 * `PUT /skills/:id` to `findByGuid` only — no `findByName` fallback.
 * The page route stays human-readable (`/skills/:name/edit`) for SEO
 * and shareability; the page must therefore resolve through
 * `useSkill(name)` first and hand `skill.guid` to every write hook.
 * A previous version of this file passed the URL param straight
 * through, which broke owner edits with a 404 on the live cluster.
 *
 * @module pages/skill/EditSkillPage.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { SkillDetail } from "@/services/skillApi";

// react-router's `useParams` is what gives the page its URL `:id`,
// i.e. the human-readable name.
vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "my-public-skill" }),
}));

// react-i18next is heavy at import time; stub it so the test stays
// focused on the hook-id contract. `initReactI18next` is referenced
// at module top-level by `src/i18n/index.ts`; stub it as a Module
// type to keep i18n's initialisation chain happy under jsdom.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? "",
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Mutable hook state — each test seeds these before render so we can
// exercise loading / not-found / visibility / upload branches without
// re-declaring the mock per case.
const refetchSpy = vi.fn();
const updateMutateAsync = vi.fn();
const updatePkgMutateAsync = vi.fn();
let skillState: {
  data: Partial<SkillDetail> | null | undefined;
  isLoading: boolean;
};

// Spies that capture the `id` argument each write hook receives.
const updateSpy = vi.fn<(id: string) => unknown>();
const updatePkgSpy = vi.fn<(id: string) => unknown>();

vi.mock("@/hooks/useSkills", () => ({
  useSkill: () => ({
    data: skillState.data,
    isLoading: skillState.isLoading,
    refetch: refetchSpy,
  }),
  useUpdateSkill: (id: string) => {
    updateSpy(id);
    return { mutateAsync: updateMutateAsync, isPending: false };
  },
  useUpdateSkillPackage: (id: string) => {
    updatePkgSpy(id);
    return { mutateAsync: updatePkgMutateAsync, isPending: false };
  },
}));

// Access tier (#1127). Mutable so tests exercise owner / write-grantee /
// reader. Mocked here so the page doesn't pull in the real authStore (whose
// persist middleware needs a storage shim this focused test doesn't set up).
let accessState = { isOwner: true, isAdmin: false, canWrite: true, canManage: true };
vi.mock("@/hooks/useSkillAccess", () => ({
  useSkillAccess: () => accessState,
}));

const addToast = vi.fn();
vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

// translateError pulls in `@/i18n`; the page only uses it on the error
// branch. Stub it to echo the fallback so error-toast assertions stay
// independent of the i18n init chain.
vi.mock("@/utils/translateError", () => ({
  translateError: (_err: unknown, fallback?: string) => fallback ?? "error",
}));

// Layout / UI bits don't matter for the contract — stub them to keep
// the test fast and immune to unrelated rendering churn.
vi.mock("@/components/layout/PageTransition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/layout/BackLink", () => ({
  BackLink: () => null,
}));

import { EditSkillPage } from "./EditSkillPage";

const PUBLIC_SKILL: Partial<SkillDetail> = {
  guid: "abc-123-guid",
  name: "my-public-skill",
  description: "...",
  isPrivate: false,
};

function resetState() {
  updateSpy.mockClear();
  updatePkgSpy.mockClear();
  refetchSpy.mockReset();
  updateMutateAsync.mockReset();
  updatePkgMutateAsync.mockReset();
  addToast.mockReset();
  updateMutateAsync.mockResolvedValue(undefined);
  updatePkgMutateAsync.mockResolvedValue(undefined);
  skillState = { data: { ...PUBLIC_SKILL }, isLoading: false };
  accessState = { isOwner: true, isAdmin: false, canWrite: true, canManage: true };
}

/** Build a fake .zip File for the upload-flow tests. */
function makeZip(name = "skill.zip"): File {
  return new File(["PK fake zip bytes"], name, {
    type: "application/zip",
  });
}

describe("EditSkillPage — write mutations receive skill.guid (#565)", () => {
  beforeEach(resetState);
  afterEach(() => cleanup());

  it("hands skill.guid (not the URL :id) to useUpdateSkill", () => {
    render(<EditSkillPage />);
    expect(updateSpy).toHaveBeenCalled();
    const lastCall = updateSpy.mock.calls[updateSpy.mock.calls.length - 1]?.[0];
    expect(lastCall).toBe("abc-123-guid");
    expect(lastCall).not.toBe("my-public-skill");
  });

  it("hands skill.guid (not the URL :id) to useUpdateSkillPackage", () => {
    render(<EditSkillPage />);
    expect(updatePkgSpy).toHaveBeenCalled();
    const lastCall =
      updatePkgSpy.mock.calls[updatePkgSpy.mock.calls.length - 1]?.[0];
    expect(lastCall).toBe("abc-123-guid");
    expect(lastCall).not.toBe("my-public-skill");
  });
});

describe("EditSkillPage — load states", () => {
  beforeEach(resetState);
  afterEach(() => cleanup());

  it("renders the skeleton while the skill is loading", () => {
    skillState = { data: undefined, isLoading: true };
    const { container } = render(<EditSkillPage />);
    // The Skeleton renders `lines` shimmer bars; no form headings yet.
    expect(container.querySelector(".skeleton-shimmer")).toBeTruthy();
    expect(screen.queryByText(/Visibility/i)).not.toBeInTheDocument();
  });

  it("renders the not-found message when the skill is missing", () => {
    skillState = { data: null, isLoading: false };
    render(<EditSkillPage />);
    expect(screen.getByText(/Skill not found/i)).toBeInTheDocument();
    expect(screen.queryByText(/Update Package/i)).not.toBeInTheDocument();
  });
});

describe("EditSkillPage — visibility toggle", () => {
  beforeEach(resetState);
  afterEach(() => cleanup());

  it("toggles a public skill to private with a success toast + refetch", async () => {
    skillState = { data: { ...PUBLIC_SKILL, isPrivate: false }, isLoading: false };
    render(<EditSkillPage />);

    fireEvent.click(screen.getByRole("button", { name: /Make Private/i }));

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({ isPrivate: true }),
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        message: expect.stringMatching(/private/i),
      }),
    );
    expect(refetchSpy).toHaveBeenCalled();
  });

  it("toggles a private skill to public with the public-copy toast", async () => {
    skillState = { data: { ...PUBLIC_SKILL, isPrivate: true }, isLoading: false };
    render(<EditSkillPage />);

    fireEvent.click(screen.getByRole("button", { name: /Make Public/i }));

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({ isPrivate: false }),
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        message: expect.stringMatching(/public/i),
      }),
    );
  });

  it("shows an error toast and skips refetch when the toggle rejects", async () => {
    updateMutateAsync.mockRejectedValue(new Error("boom"));
    render(<EditSkillPage />);

    fireEvent.click(screen.getByRole("button", { name: /Make Private/i }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      ),
    );
    expect(refetchSpy).not.toHaveBeenCalled();
  });
});

describe("EditSkillPage — package upload", () => {
  beforeEach(resetState);
  afterEach(() => cleanup());

  function selectZip(container: HTMLElement) {
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [makeZip()] } });
    return fileInput;
  }

  it("reveals the Upload button once a file is selected", () => {
    const { container } = render(<EditSkillPage />);
    expect(
      screen.queryByRole("button", { name: /Upload Package/i }),
    ).not.toBeInTheDocument();

    selectZip(container);

    expect(screen.getByText("skill.zip")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Upload Package/i }),
    ).toBeInTheDocument();
  });

  it("uploads, fires a success toast, clears the picker and refetches", async () => {
    const { container } = render(<EditSkillPage />);
    selectZip(container);

    fireEvent.click(screen.getByRole("button", { name: /Upload Package/i }));

    await waitFor(() =>
      expect(updatePkgMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ zipFile: expect.any(File) }),
      ),
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
    expect(refetchSpy).toHaveBeenCalled();
    // The picker clears — selected filename + Upload button gone.
    await waitFor(() =>
      expect(screen.queryByText("skill.zip")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /Upload Package/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an error toast and keeps the file when the upload rejects", async () => {
    updatePkgMutateAsync.mockRejectedValue(new Error("upload failed"));
    const { container } = render(<EditSkillPage />);
    selectZip(container);

    fireEvent.click(screen.getByRole("button", { name: /Upload Package/i }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      ),
    );
    expect(refetchSpy).not.toHaveBeenCalled();
    // File stays selected so the user can retry.
    expect(screen.getByText("skill.zip")).toBeInTheDocument();
  });

  it("clears the selected file via the Remove control", () => {
    const { container } = render(<EditSkillPage />);
    selectZip(container);
    expect(screen.getByText("skill.zip")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remove/i }));

    expect(screen.queryByText("skill.zip")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Upload Package/i }),
    ).not.toBeInTheDocument();
  });
});

describe("EditSkillPage — access tiers (#1127)", () => {
  beforeEach(resetState);
  afterEach(() => cleanup());

  it("a write-grantee sees Update Package but NOT the Visibility (admin) toggle", () => {
    accessState = { isOwner: false, isAdmin: false, canWrite: true, canManage: false };
    render(<EditSkillPage />);
    expect(screen.getByText(/Update Package/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Visibility$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Make (Public|Private)/i }),
    ).not.toBeInTheDocument();
  });

  it("a read-only viewer sees a read-only notice and no edit controls", () => {
    accessState = { isOwner: false, isAdmin: false, canWrite: false, canManage: false };
    render(<EditSkillPage />);
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
    expect(screen.queryByText(/Update Package/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Make (Public|Private)/i }),
    ).not.toBeInTheDocument();
  });
});
