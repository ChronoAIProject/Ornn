/**
 * MirrorPage tests — re-seed-on-refetch guard (#888).
 *
 * Both forms (repo settings + App credentials) seed from `status` using
 * the "adjust state during render" guard keyed on the server object
 * IDENTITY. A refetch that returns a NEW status object re-seeds the
 * fields; a same-reference rerender preserves the admin's in-flight edits.
 *
 * STALE-STATE-FIRST oracle: load v1 (seeds the owner/repo/branch +
 * appId/etc. fields), DIRTY a field, then (a) same-ref rerender → the edit
 * survives; (b) new-ref refetch → the field re-seeds to the server value.
 *
 * Hooks + toast store + apiClient (for `ApiClientError`) are mocked so the
 * page renders without the live auth/network chain. framer-motion (used by
 * PageTransition + MirrorSetupHelp) is stubbed pass-through. react-i18next
 * is stubbed globally in src/test/setup.ts.
 *
 * @module pages/admin/MirrorPage.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MirrorStatus } from "@/services/githubMirrorApi";

const useMirrorStatus = vi.fn();
const useTriggerReconcile = vi.fn();
const useUpdateMirrorConfig = vi.fn();
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
          variants: _v,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          void _i;
          void _a;
          void _e;
          void _tr;
          void _v;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  ),
}));

vi.mock("@/hooks/useGithubMirror", () => ({
  useMirrorStatus: () => useMirrorStatus(),
  useTriggerReconcile: () => useTriggerReconcile(),
  useUpdateMirrorConfig: () => useUpdateMirrorConfig(),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

// Stub apiClient so importing `ApiClientError` doesn't drag in the
// authStore localStorage init chain on module load.
vi.mock("@/services/apiClient", () => ({
  ApiClientError: class ApiClientError extends Error {
    code: string | null = null;
  },
}));

import { MirrorPage } from "./MirrorPage";

function status(owner: string, branch = "main"): MirrorStatus {
  return {
    enabled: true,
    repo: { owner, repo: "ornn-skills", branch },
    appId: "123456",
    installationId: "78901234",
    appPrivateKey: "•••masked•••",
    counts: {
      eligible: 10,
      synced: 8,
      lagging: 1,
      neverSynced: 1,
      oldestUnsyncedAt: null,
    },
    scheduledRun: {
      status: "succeeded",
      lastRunAt: null,
      lastFinishedAt: "2026-05-01T00:00:00.000Z",
      lastDurationMs: 1234,
      lastError: null,
      nextRunAt: null,
    },
  };
}

function loading() {
  return { data: undefined, isLoading: false, isError: false } as const;
}
function loaded(data: MirrorStatus) {
  return { data, isLoading: false, isError: false } as const;
}

function ownerInput(): HTMLInputElement {
  return screen.getByPlaceholderText("ChronoAIProject") as HTMLInputElement;
}

beforeEach(() => {
  useMirrorStatus.mockReset();
  useTriggerReconcile.mockReset();
  useUpdateMirrorConfig.mockReset();
  addToast.mockReset();
  useTriggerReconcile.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useUpdateMirrorConfig.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

afterEach(() => {
  cleanup();
});

describe("MirrorPage — re-seed on refetch", () => {
  it("seeds the repo form once the status arrives", () => {
    // Guard initialises prevStatus to `status` on the first render; the seed
    // only fires on the undefined → v1 transition (real query lifecycle).
    useMirrorStatus.mockReturnValue(loading());
    const { rerender } = render(<MirrorPage />);

    useMirrorStatus.mockReturnValue(loaded(status("ChronoAIProject")));
    rerender(<MirrorPage />);
    expect(ownerInput().value).toBe("ChronoAIProject");
  });

  it("preserves a dirty owner edit across a same-reference rerender", () => {
    const v1 = status("ChronoAIProject");
    useMirrorStatus.mockReturnValue(loading());
    const { rerender } = render(<MirrorPage />);
    useMirrorStatus.mockReturnValue(loaded(v1));
    rerender(<MirrorPage />);

    // Force the wrong state relative to the server.
    fireEvent.change(ownerInput(), { target: { value: "DirtyOwner" } });
    expect(ownerInput().value).toBe("DirtyOwner");

    // Same status ref (e.g. a poll that returned an identical cached object
    // reference) → guard does not re-seed; the edit survives.
    useMirrorStatus.mockReturnValue(loaded(v1));
    rerender(<MirrorPage />);
    expect(ownerInput().value).toBe("DirtyOwner");
  });

  it("re-seeds when a refetch produces a new status object", () => {
    const v1 = status("ChronoAIProject");
    useMirrorStatus.mockReturnValue(loading());
    const { rerender } = render(<MirrorPage />);
    useMirrorStatus.mockReturnValue(loaded(v1));
    rerender(<MirrorPage />);

    fireEvent.change(ownerInput(), { target: { value: "DirtyOwner" } });
    expect(ownerInput().value).toBe("DirtyOwner");

    // Refetch: NEW object identity with a different owner → re-seed wins,
    // discarding the local edit.
    useMirrorStatus.mockReturnValue(loaded(status("AnotherOrg")));
    rerender(<MirrorPage />);
    expect(ownerInput().value).toBe("AnotherOrg");
  });
});
