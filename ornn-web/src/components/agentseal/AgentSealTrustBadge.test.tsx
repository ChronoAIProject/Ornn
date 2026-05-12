import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The badge imports `apiPost` from `@/services/apiClient` for the rescan
// button. That module's transitive `authStore` import calls
// `useAuthStore.getState().initialize()` at load time, which crashes
// under jsdom because Zustand's persist middleware can't write to
// localStorage. Render tests for the badge don't need either.
vi.mock("@/services/apiClient", () => ({ apiPost: vi.fn() }));
vi.mock("@/stores/toastStore", () => ({
  useToastStore: Object.assign(() => () => {}, {
    getState: () => ({ addToast: () => {} }),
  }),
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
});
