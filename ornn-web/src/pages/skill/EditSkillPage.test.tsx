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
import { render, cleanup } from "@testing-library/react";
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

// Spies that capture the `id` argument each write hook receives.
const updateSpy = vi.fn<(id: string) => unknown>();
const updatePkgSpy = vi.fn<(id: string) => unknown>();

vi.mock("@/hooks/useSkills", () => ({
  useSkill: () => ({
    data: {
      guid: "abc-123-guid",
      name: "my-public-skill",
      description: "...",
      isPrivate: false,
    } satisfies Partial<SkillDetail>,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useUpdateSkill: (id: string) => {
    updateSpy(id);
    return { mutateAsync: vi.fn(), isPending: false };
  },
  useUpdateSkillPackage: (id: string) => {
    updatePkgSpy(id);
    return { mutateAsync: vi.fn(), isPending: false };
  },
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: () => vi.fn(),
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

describe("EditSkillPage — write mutations receive skill.guid (#565)", () => {
  beforeEach(() => {
    updateSpy.mockClear();
    updatePkgSpy.mockClear();
  });
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
