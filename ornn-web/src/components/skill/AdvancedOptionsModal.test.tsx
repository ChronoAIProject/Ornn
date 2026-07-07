/**
 * AdvancedOptionsModal tests — prop→internal-state sync guards (#888).
 *
 * Two inner panels each carry an "adjust state during render" guard that
 * syncs local state to a changing `skill` prop:
 *
 *   - NyxidServiceBindingPanel: `selectedId` follows `skill.nyxidServiceId`.
 *   - GithubLinkPanel: `url` (+ cleared preview) follows the derived
 *     `initialUrl` from `skill.source`.
 *
 * Without the guards, switching the modal's `skill` prop from A to B (the
 * drawer stays open) would leave the picker / URL field pinned to A's
 * stale value.
 *
 * STALE-STATE-FIRST oracle: render with skill A (panel reflects A's bound
 * service / linked URL), switch the `skill` prop to B WITHOUT closing →
 * the panel's internal state syncs to B, not the stale A.
 *
 * All data/mutation hooks + toast store are mocked; framer-motion (Modal
 * AnimatePresence) + VersionDiffView are stubbed. react-i18next is global.
 *
 * @module components/skill/AdvancedOptionsModal.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SkillDetail } from "@/types/domain";
import type { MyNyxidService } from "@/services/meApi";

const useMyNyxidServices = vi.fn();
const addToast = vi.fn();

// Pass-through framer-motion. The motion proxy CACHES one component per
// tag so the element TYPE is stable across rerenders — otherwise React sees
// a fresh `motion.div` function each render and remounts the whole subtree,
// wiping the inner panel state these tests rely on persisting.
vi.mock("framer-motion", () => {
  const cache = new Map<string, React.FC<Record<string, unknown> & { children?: React.ReactNode }>>();
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_t, tag: string) => {
          const cached = cache.get(tag);
          if (cached) return cached;
          const Comp: React.FC<Record<string, unknown> & { children?: React.ReactNode }> = ({
            children,
            initial: _i,
            animate: _a,
            exit: _e,
            transition: _tr,
            ...rest
          }) => {
            void _i;
            void _a;
            void _e;
            void _tr;
            const Tag = tag as keyof React.JSX.IntrinsicElements;
            return <Tag {...rest}>{children}</Tag>;
          };
          cache.set(tag, Comp);
          return Comp;
        },
      },
    ),
  };
});

vi.mock("@/hooks/useMe", () => ({
  useMyNyxidServices: () => useMyNyxidServices(),
}));

const mutationStub = () => ({ mutateAsync: vi.fn(), isPending: false });
vi.mock("@/hooks/useSkills", () => ({
  useTieSkillToNyxidService: () => mutationStub(),
  useSetSkillSource: () => mutationStub(),
  usePreviewSkillRefresh: () => mutationStub(),
  useRefreshSkillFromSource: () => mutationStub(),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

vi.mock("@/components/skill/VersionDiffView", () => ({
  VersionDiffView: () => <div data-testid="diff" />,
}));

import { AdvancedOptionsModal } from "./AdvancedOptionsModal";

const SERVICES: MyNyxidService[] = [
  { id: "svc-personal-1", slug: "alpha", label: "Alpha Service", tier: "personal" },
  { id: "svc-personal-2", slug: "bravo", label: "Bravo Service", tier: "personal" },
];

function skill(overrides: Partial<SkillDetail>): SkillDetail {
  return {
    guid: "skill-guid",
    name: "demo-skill",
    description: "",
    createdBy: "u1",
    createdOn: "2026-05-01T00:00:00.000Z",
    isPrivate: false,
    tags: [],
    updatedOn: "2026-05-01T00:00:00.000Z",
    metadata: {},
    version: "1.0.0",
    sharedWithUsers: [],
    sharedWithOrgs: [],
    nyxidServiceId: null,
    ...overrides,
  } as SkillDetail;
}

/** The selected ServiceOption button carries the `border-accent/60` class. */
function selectedServiceLabel(): string | null {
  const btns = screen.getAllByRole("button");
  const sel = btns.find((b) => b.className.includes("border-accent/60"));
  if (!sel) return null;
  // The label is the first child span's text.
  return sel.querySelector("span")?.textContent ?? null;
}

beforeEach(() => {
  useMyNyxidServices.mockReset();
  addToast.mockReset();
  useMyNyxidServices.mockReturnValue({ data: SERVICES, isLoading: false });
});

afterEach(() => {
  cleanup();
});

describe("AdvancedOptionsModal — NyxID binding panel syncs to the skill prop", () => {
  it("reflects skill A's bound service on open", () => {
    render(
      <AdvancedOptionsModal
        isOpen
        onClose={() => {}}
        skill={skill({ nyxidServiceId: "svc-personal-1" })}
      />,
    );
    expect(selectedServiceLabel()).toBe("Alpha Service");
  });

  it("syncs the picker to B's bound service when the skill prop switches", () => {
    const { rerender } = render(
      <AdvancedOptionsModal
        isOpen
        onClose={() => {}}
        skill={skill({ nyxidServiceId: "svc-personal-1" })}
      />,
    );
    expect(selectedServiceLabel()).toBe("Alpha Service");

    // Switch the skill prop WITHOUT closing the modal — the render-time
    // guard must re-point `selectedId` at B's bound service.
    rerender(
      <AdvancedOptionsModal
        isOpen
        onClose={() => {}}
        skill={skill({ guid: "skill-guid", nyxidServiceId: "svc-personal-2" })}
      />,
    );
    expect(selectedServiceLabel()).toBe("Bravo Service");
    expect(selectedServiceLabel()).not.toBe("Alpha Service");
  });
});

describe("AdvancedOptionsModal — GitHub link panel syncs to the skill prop", () => {
  function openGithubPanel() {
    // Switch the left rail to the "Link to GitHub" setting.
    fireEvent.click(screen.getByRole("button", { name: /link to github/i }));
  }

  function githubUrlInput(): HTMLInputElement {
    return screen.getByLabelText(/github folder url/i) as HTMLInputElement;
  }

  const sourceA = {
    type: "github" as const,
    repo: "owner/repo-a",
    ref: "main",
    path: "skills/a",
  };
  const sourceB = {
    type: "github" as const,
    repo: "owner/repo-b",
    ref: "main",
    path: "skills/b",
  };

  it("reflects skill A's linked URL on open", () => {
    render(
      <AdvancedOptionsModal isOpen onClose={() => {}} skill={skill({ source: sourceA })} />,
    );
    openGithubPanel();
    expect(githubUrlInput().value).toContain("repo-a");
  });

  it("syncs the URL field to B's linked source when the skill prop switches", () => {
    const { rerender } = render(
      <AdvancedOptionsModal isOpen onClose={() => {}} skill={skill({ source: sourceA })} />,
    );
    openGithubPanel();
    expect(githubUrlInput().value).toContain("repo-a");

    // Switch the skill prop — the derived `initialUrl` changes, so the
    // render-time guard re-seeds the URL field to B's source.
    rerender(
      <AdvancedOptionsModal
        isOpen
        onClose={() => {}}
        skill={skill({ guid: "skill-guid", source: sourceB })}
      />,
    );
    // The rail selection is preserved (only the skill prop changed), so the
    // GitHub panel is still shown and now reflects B.
    expect(githubUrlInput().value).toContain("repo-b");
    expect(githubUrlInput().value).not.toContain("repo-a");
  });
});
