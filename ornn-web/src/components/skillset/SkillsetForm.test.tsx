/**
 * SkillsetForm — create vs. edit contract.
 *
 * create: name is editable; submit requires ≥2 members + a required prompt;
 *         the create payload carries name / members / instructions / version.
 * edit:   name is LOCKED (display-only, no name field); the version must be
 *         BUMPED — submitting with the same loaded version is rejected, a new
 *         version publishes.
 *
 * The member picker's skill-search query is gated on focus + non-empty query
 * and never runs (we drive raw refs via Enter), so only a QueryClient is
 * needed — plus the auth-store stub so the api layer import chain stays inert.
 *
 * @module components/skillset/SkillsetForm.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: {
    getState: () => ({
      accessToken: null,
      isAuthenticated: false,
      ensureFreshToken: async () => {},
      refreshToken: async () => {},
    }),
  },
}));

// The dependency graph renders a Mermaid preview — stub it (heavy in jsdom).
vi.mock("@/components/docs/DocsMermaid", () => ({
  MermaidBlock: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

import { SkillsetForm } from "./SkillsetForm";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Add a member ref via the picker's raw-ref Enter path. */
function addMember(ref: string) {
  const input = screen.getByPlaceholderText(/search a skill/);
  fireEvent.change(input, { target: { value: ref } });
  fireEvent.keyDown(input, { key: "Enter" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsetForm — create", () => {
  it("submits a create payload with name, ≥2 members, prompt, and version", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    wrap(<SkillsetForm mode="create" onCreate={onCreate} />);

    fireEvent.change(screen.getByPlaceholderText("research-bundle"), {
      target: { value: "research-bundle" },
    });
    fireEvent.change(screen.getByPlaceholderText(/human-readable summary/), {
      target: { value: "A bundle" },
    });
    addMember("a@1.0");
    addMember("b@1.0");
    // The master prompt textarea is the MarkdownEditor's first textbox.
    const promptBox = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(promptBox, { target: { value: "Run A, then B." } });

    fireEvent.click(screen.getByRole("button", { name: "Create skillset" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      name: "research-bundle",
      members: ["a@1.0", "b@1.0"],
      instructions: "Run A, then B.",
      version: "1.0",
    });
  });

  it("blocks submit with fewer than 2 members", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    wrap(<SkillsetForm mode="create" onCreate={onCreate} />);

    fireEvent.change(screen.getByPlaceholderText("research-bundle"), { target: { value: "x" } });
    fireEvent.change(screen.getByPlaceholderText(/human-readable summary/), {
      target: { value: "d" },
    });
    addMember("a@1.0"); // only one
    const promptBox = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(promptBox, { target: { value: "do it" } });

    // Submit button is disabled (membersValid false).
    expect(screen.getByRole("button", { name: "Create skillset" })).toBeDisabled();
  });

  it("blocks submit when the master prompt is empty", () => {
    wrap(<SkillsetForm mode="create" onCreate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("research-bundle"), { target: { value: "x" } });
    fireEvent.change(screen.getByPlaceholderText(/human-readable summary/), {
      target: { value: "d" },
    });
    addMember("a@1.0");
    addMember("b@1.0");
    // No prompt typed → still disabled.
    expect(screen.getByRole("button", { name: "Create skillset" })).toBeDisabled();
  });
});

describe("SkillsetForm — dependency graph wiring (#1064)", () => {
  /** Click the graph node whose label starts with `name`. */
  function clickGraphNode(name: string) {
    const buttons = screen.getByTestId("graph-columns").querySelectorAll("button");
    const target = [...buttons].find((b) => b.textContent?.startsWith(name));
    if (!target) throw new Error(`graph node ${name} not found`);
    fireEvent.click(target);
  }

  function setupCreateWithTwoMembers() {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    wrap(<SkillsetForm mode="create" onCreate={onCreate} />);
    fireEvent.change(screen.getByPlaceholderText("research-bundle"), {
      target: { value: "research-bundle" },
    });
    fireEvent.change(screen.getByPlaceholderText(/human-readable summary/), {
      target: { value: "A bundle" },
    });
    addMember("a@1.0");
    addMember("b@1.0");
    return onCreate;
  }

  function promptBox(): HTMLTextAreaElement {
    return screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
  }

  it("adding an edge then editing prose preserves the edge in the submitted instructions", async () => {
    const onCreate = setupCreateWithTwoMembers();
    // Draw a@1.0 → b@1.0.
    clickGraphNode("a");
    clickGraphNode("b");
    // Now type the prose body.
    fireEvent.change(promptBox(), { target: { value: "Run A, then B." } });

    fireEvent.click(screen.getByRole("button", { name: "Create skillset" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    const sent = onCreate.mock.calls[0]?.[0] as { instructions: string };
    // The prose survives AND the managed deps block carries the edge.
    expect(sent.instructions).toContain("Run A, then B.");
    expect(sent.instructions).toContain("<!-- ornn:deps:start -->");
    expect(sent.instructions).toContain('n0["a@1.0"] --> n1["b@1.0"]');
  });

  it("removing a member prunes its edges from the instructions", async () => {
    const onCreate = setupCreateWithTwoMembers();
    addMember("c@1.0");
    // Edge b@1.0 → c@1.0.
    clickGraphNode("b");
    clickGraphNode("c");
    fireEvent.change(promptBox(), { target: { value: "Body." } });

    // Remove member c via its picker chip.
    fireEvent.click(screen.getByRole("button", { name: "Remove c@1.0" }));

    fireEvent.click(screen.getByRole("button", { name: "Create skillset" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    const sent = onCreate.mock.calls[0]?.[0] as { instructions: string; members: string[] };
    expect(sent.members).toEqual(["a@1.0", "b@1.0"]);
    // The b→c edge referenced the removed member → pruned out entirely. With no
    // edges left, the codec drops the managed block.
    expect(sent.instructions).toBe("Body.");
  });

  it("the prose editor and graph coexist — neither clobbers the other", async () => {
    const onCreate = setupCreateWithTwoMembers();
    fireEvent.change(promptBox(), { target: { value: "First prose." } });
    clickGraphNode("a");
    clickGraphNode("b");
    // Edit prose again AFTER drawing the edge.
    fireEvent.change(promptBox(), { target: { value: "Updated prose." } });

    fireEvent.click(screen.getByRole("button", { name: "Create skillset" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    const sent = onCreate.mock.calls[0]?.[0] as { instructions: string };
    expect(sent.instructions).toContain("Updated prose.");
    expect(sent.instructions).not.toContain("First prose.");
    expect(sent.instructions).toContain('n0["a@1.0"] --> n1["b@1.0"]');
  });
});

describe("SkillsetForm — edit", () => {
  const initial = {
    name: "research-bundle",
    description: "A bundle",
    instructions: "Run A, then B.",
    kind: "generic" as const,
    tags: ["research"],
    members: ["a@1.0", "b@1.0"],
    version: "1.0",
  };

  it("locks the name (no editable name field, label shows the locked name)", () => {
    wrap(<SkillsetForm mode="edit" initial={initial} onPublish={vi.fn()} />);
    // No editable input for the name (it's render-only).
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByText("research-bundle")).toBeInTheDocument();
    expect(screen.getByText("(locked)")).toBeInTheDocument();
  });

  it("rejects publishing with the same (un-bumped) version", () => {
    wrap(<SkillsetForm mode="edit" initial={initial} onPublish={vi.fn()} />);
    // Version field is pre-seeded with the loaded "1.0" → not bumped → disabled.
    expect(screen.getByRole("button", { name: "Publish version" })).toBeDisabled();
  });

  it("publishes when the version is bumped", async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    wrap(<SkillsetForm mode="edit" initial={initial} onPublish={onPublish} />);

    // The version field is pre-seeded with the loaded "1.0"; bump it.
    fireEvent.change(screen.getByDisplayValue("1.0"), { target: { value: "1.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish version" }));

    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
    expect(onPublish.mock.calls[0]?.[0]).toMatchObject({
      version: "1.1",
      members: ["a@1.0", "b@1.0"],
      instructions: "Run A, then B.",
    });
    // The create-only `name` field is never part of the publish payload.
    expect(onPublish.mock.calls[0]?.[0]).not.toHaveProperty("name");
  });
});
