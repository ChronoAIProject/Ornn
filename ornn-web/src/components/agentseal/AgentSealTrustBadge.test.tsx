import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";

// The badge imports `apiPost` from `@/services/apiClient` for the rescan
// button. That module's transitive `authStore` import calls
// `useAuthStore.getState().initialize()` at load time, which crashes
// under jsdom because Zustand's persist middleware can't write to
// localStorage. Render tests for the badge don't need either.
//
// The toast store mock honours the `(s) => s.addToast` selector so the
// rescan tests can capture toast calls; the spy is reset per-test.
const apiPost = vi.fn();
const addToast = vi.fn();

vi.mock("@/services/apiClient", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
}));
vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

import { AgentSealTrustBadge } from "./AgentSealTrustBadge";
import type { AgentSealScan } from "@/types/domain";

function makeScan(overrides: Partial<AgentSealScan> = {}): AgentSealScan {
  return {
    score: 92,
    findings: [],
    scannedAt: "2026-05-04T08:30:00.000Z",
    version: "agentseal-0.4.1",
    ...overrides,
  };
}

describe("AgentSealTrustBadge", () => {
  it("renders the unscanned variant when no scan is provided", () => {
    render(<AgentSealTrustBadge scan={null} />);
    expect(screen.getByText(/Not scanned/i)).toBeInTheDocument();
    expect(screen.queryByText(/findings/i)).not.toBeInTheDocument();
  });

  it("renders score + band + scan timestamp + AgentSeal version when scanned", () => {
    render(<AgentSealTrustBadge scan={makeScan({ score: 92 })} />);
    // Score appears twice — once in the swatch, once in the big number.
    const matches = screen.getAllByText(/92/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Excellent/i)).toBeInTheDocument();
    expect(screen.getByText(/AgentSeal 0\.4\.1/i)).toBeInTheDocument();
  });

  it("shows '0 findings' when the scan ran clean", () => {
    render(<AgentSealTrustBadge scan={makeScan({ findings: [] })} />);
    expect(screen.getByRole("button", { name: /clean — 0 findings/i })).toBeInTheDocument();
  });

  it("expands the findings list when the toggle is clicked", () => {
    const scan = makeScan({
      score: 42,
      findings: [
        {
          ruleId: "prompt-injection-zw",
          title: "Zero-width injection",
          severity: "critical",
          message: "Detected zero-width characters in SKILL.md.",
          location: { file: "SKILL.md", line: 12 },
        },
        {
          ruleId: "tool-allowlist-broad",
          title: "Broad tool allowlist",
          severity: "low",
          message: "Skill grants every tool by default.",
        },
      ],
    });

    render(<AgentSealTrustBadge scan={scan} />);

    const toggle = screen.getByRole("button", { name: /2 findings/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByText(/Zero-width injection/i)).toBeInTheDocument();
    expect(screen.getByText(/Broad tool allowlist/i)).toBeInTheDocument();
    expect(screen.getByText(/SKILL.md:12/)).toBeInTheDocument();
  });

  it("sorts findings worst-first regardless of upstream order", () => {
    const scan = makeScan({
      findings: [
        {
          ruleId: "low-1",
          title: "Low",
          severity: "low",
          message: "low",
        },
        {
          ruleId: "crit-1",
          title: "Critical",
          severity: "critical",
          message: "crit",
        },
        {
          ruleId: "med-1",
          title: "Medium",
          severity: "medium",
          message: "med",
        },
      ],
    });

    render(<AgentSealTrustBadge scan={scan} />);
    fireEvent.click(screen.getByRole("button", { name: /3 findings/i }));

    const titles = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p")?.textContent ?? "");
    expect(titles).toEqual(["Critical", "Medium", "Low"]);
  });

  it("clamps out-of-range scores into [0, 100] for display", () => {
    render(<AgentSealTrustBadge scan={makeScan({ score: 150 })} />);
    // The 150 is shown as 100; band stays excellent.
    expect(screen.getAllByText(/100/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Excellent/i)).toBeInTheDocument();

    render(<AgentSealTrustBadge scan={makeScan({ score: -5 })} />);
    expect(screen.getAllByText(/0/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Critical/i)).toBeInTheDocument();
  });

  describe("clean-100 explainer", () => {
    it("uses the singular noun for a single scanned file", () => {
      render(
        <AgentSealTrustBadge
          scan={makeScan({ score: 100, findings: [], scannedFiles: 1 })}
        />,
      );
      // Explainer copy embeds "1 scanned file" (singular, no trailing s).
      expect(
        screen.getByText(/across 1 scanned file\./i),
      ).toBeInTheDocument();
      // The metadata line below also reads the singular noun.
      expect(screen.getByText(/1 file$/)).toBeInTheDocument();
    });

    it("uses the plural noun for multiple scanned files", () => {
      render(
        <AgentSealTrustBadge
          scan={makeScan({ score: 100, findings: [], scannedFiles: 3 })}
        />,
      );
      expect(
        screen.getByText(/across 3 scanned files\./i),
      ).toBeInTheDocument();
      expect(screen.getByText(/3 files/)).toBeInTheDocument();
    });

    it("omits the explainer when the score is below 100", () => {
      render(
        <AgentSealTrustBadge
          scan={makeScan({ score: 92, findings: [], scannedFiles: 5 })}
        />,
      );
      expect(
        screen.queryByText(/No malicious patterns/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("severity tones", () => {
    it("tags each finding row with its severity for tone styling", () => {
      const scan = makeScan({
        score: 20,
        findings: [
          { ruleId: "c", title: "C", severity: "critical", message: "c" },
          { ruleId: "h", title: "H", severity: "high", message: "h" },
          { ruleId: "m", title: "M", severity: "medium", message: "m" },
          { ruleId: "l", title: "L", severity: "low", message: "l" },
          { ruleId: "i", title: "I", severity: "info", message: "i" },
        ],
      });
      render(<AgentSealTrustBadge scan={scan} />);
      fireEvent.click(screen.getByRole("button", { name: /5 findings/i }));

      const rows = screen.getAllByRole("listitem");
      // Sorted worst-first, so the data-severity order is deterministic.
      expect(rows.map((r) => r.getAttribute("data-severity"))).toEqual([
        "critical",
        "high",
        "medium",
        "low",
        "info",
      ]);
    });
  });

  describe("rescan flow", () => {
    beforeEach(() => {
      apiPost.mockReset();
      addToast.mockReset();
    });
    afterEach(() => cleanup());

    const RESCAN_PROPS = {
      canRescan: true,
      skillIdOrName: "my-skill",
      version: "1.2.3",
    } as const;

    it("renders the rescan button only when canRescan + ids + version are present", () => {
      const { rerender } = render(
        <AgentSealTrustBadge scan={makeScan()} {...RESCAN_PROPS} />,
      );
      expect(
        screen.getByRole("button", { name: /rescan/i }),
      ).toBeInTheDocument();

      // Missing the admin flag — no button.
      rerender(
        <AgentSealTrustBadge
          scan={makeScan()}
          canRescan={false}
          skillIdOrName="my-skill"
          version="1.2.3"
        />,
      );
      expect(
        screen.queryByRole("button", { name: /rescan/i }),
      ).not.toBeInTheDocument();

      // Missing the version — no button even with the flag.
      rerender(
        <AgentSealTrustBadge
          scan={makeScan()}
          canRescan
          skillIdOrName="my-skill"
        />,
      );
      expect(
        screen.queryByRole("button", { name: /rescan/i }),
      ).not.toBeInTheDocument();

      // Missing the skill id — no button.
      rerender(
        <AgentSealTrustBadge scan={makeScan()} canRescan version="1.2.3" />,
      );
      expect(
        screen.queryByRole("button", { name: /rescan/i }),
      ).not.toBeInTheDocument();
    });

    it("shows the rescan button on the unscanned variant too", () => {
      render(<AgentSealTrustBadge scan={null} {...RESCAN_PROPS} />);
      expect(
        screen.getByRole("button", { name: /rescan/i }),
      ).toBeInTheDocument();
    });

    it("fires a success toast and onRescanned on a clean response", async () => {
      apiPost.mockResolvedValue({ data: { scan: makeScan() }, error: null });
      const onRescanned = vi.fn();
      render(
        <AgentSealTrustBadge
          scan={makeScan()}
          {...RESCAN_PROPS}
          onRescanned={onRescanned}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /rescan/i }));

      await waitFor(() =>
        expect(addToast).toHaveBeenCalledWith(
          expect.objectContaining({ type: "success" }),
        ),
      );
      expect(apiPost).toHaveBeenCalledWith(
        "/api/v1/admin/skills/my-skill/versions/1.2.3/agentseal-rescan",
        {},
      );
      expect(onRescanned).toHaveBeenCalledTimes(1);
    });

    it("shows the disabled-copy toast on an agentseal_disabled error", async () => {
      apiPost.mockResolvedValue({
        error: { code: "agentseal_disabled", message: "ignored" },
      });
      const onRescanned = vi.fn();
      render(
        <AgentSealTrustBadge
          scan={makeScan()}
          {...RESCAN_PROPS}
          onRescanned={onRescanned}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /rescan/i }));

      await waitFor(() =>
        expect(addToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            message: expect.stringMatching(/not configured/i),
          }),
        ),
      );
      // The disabled branch never reports success.
      expect(onRescanned).not.toHaveBeenCalled();
    });

    it("surfaces the server error message on a generic error", async () => {
      apiPost.mockResolvedValue({
        error: { code: "rescan_failed", message: "Scanner is offline" },
      });
      render(<AgentSealTrustBadge scan={makeScan()} {...RESCAN_PROPS} />);

      fireEvent.click(screen.getByRole("button", { name: /rescan/i }));

      await waitFor(() =>
        expect(addToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            message: "Scanner is offline",
          }),
        ),
      );
    });

    it("falls back to the translateError path on a thrown rejection", async () => {
      apiPost.mockRejectedValue(new Error("Network down"));
      render(<AgentSealTrustBadge scan={makeScan()} {...RESCAN_PROPS} />);

      fireEvent.click(screen.getByRole("button", { name: /rescan/i }));

      await waitFor(() =>
        expect(addToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            message: expect.stringMatching(/Network down/i),
          }),
        ),
      );
    });

    it("disables the rescan button while the request is in flight", async () => {
      let resolve!: (v: unknown) => void;
      apiPost.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      render(<AgentSealTrustBadge scan={makeScan()} {...RESCAN_PROPS} />);

      const btn = screen.getByRole("button", { name: /rescan|scanning/i });
      fireEvent.click(btn);

      // The loading label switches and the button is disabled mid-flight.
      await waitFor(() => expect(btn).toBeDisabled());

      // Settle the request so the test doesn't leak a pending promise.
      resolve({ data: { scan: makeScan() }, error: null });
      await waitFor(() => expect(btn).not.toBeDisabled());
    });
  });
});
