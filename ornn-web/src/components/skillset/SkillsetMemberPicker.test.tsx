/**
 * SkillsetMemberPicker — client-side member-ref rejections + count hint.
 *
 * Mirrors the backend v1 rules: reject `skillset:`-prefixed refs (no nested
 * skillsets), reject a ref pointing at the skillset being edited (self), and
 * reject duplicates. A valid ref is added as a chip and pushed up via
 * `onChange`. The 2–100 count bound is surfaced as a count hint; the picker
 * blocks adding past the max.
 *
 * The skill-search query is gated on focus + a non-empty debounced query and
 * never runs here (we drive the raw-ref Enter path), so no network mock is
 * needed beyond a QueryClient.
 *
 * @module components/skillset/SkillsetMemberPicker.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Stub the auth store so importing the api layer (via searchSkills) doesn't
// run the persist-middleware localStorage init chain on module load.
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

import { SkillsetMemberPicker } from "./SkillsetMemberPicker";
import { SKILLSET_MAX_MEMBERS } from "@/types/skillset";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function typeAndEnter(value: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

afterEach(() => {
  cleanup();
});

describe("SkillsetMemberPicker", () => {
  it("adds a valid raw ref as a chip via onChange", () => {
    const onChange = vi.fn();
    render(wrap(<SkillsetMemberPicker members={[]} onChange={onChange} />));
    typeAndEnter("pdf-tools@1.0");
    expect(onChange).toHaveBeenCalledWith(["pdf-tools@1.0"]);
  });

  it("rejects a nested skillset: ref without calling onChange", () => {
    const onChange = vi.fn();
    render(wrap(<SkillsetMemberPicker members={[]} onChange={onChange} />));
    typeAndEnter("skillset:other-set@1.0");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/skillset/i);
  });

  it("rejects a ref pointing at the skillset being edited (self)", () => {
    const onChange = vi.fn();
    render(
      wrap(<SkillsetMemberPicker members={[]} onChange={onChange} selfName="research-bundle" />),
    );
    typeAndEnter("research-bundle@1.0");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/itself/i);
  });

  it("rejects a versionless ref (no @) client-side", () => {
    const onChange = vi.fn();
    render(wrap(<SkillsetMemberPicker members={[]} onChange={onChange} />));
    typeAndEnter("pdf-tools");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/version/i);
  });

  it("rejects an empty-version ref (name@) client-side", () => {
    const onChange = vi.fn();
    render(wrap(<SkillsetMemberPicker members={[]} onChange={onChange} />));
    typeAndEnter("pdf-tools@");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/version/i);
  });

  it("rejects a duplicate member", () => {
    const onChange = vi.fn();
    render(wrap(<SkillsetMemberPicker members={["a@1.0"]} onChange={onChange} />));
    typeAndEnter("a@1.0");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/already/i);
  });

  it("blocks adding past the max member count", () => {
    const full = Array.from({ length: SKILLSET_MAX_MEMBERS }, (_, i) => `s${i}@1.0`);
    const onChange = vi.fn();
    render(wrap(<SkillsetMemberPicker members={full} onChange={onChange} />));
    typeAndEnter("one-more@1.0");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(new RegExp(String(SKILLSET_MAX_MEMBERS)));
  });

  it("surfaces a below-minimum count hint with the max bound", () => {
    render(wrap(<SkillsetMemberPicker members={["a@1.0"]} onChange={vi.fn()} />));
    // "1 / 100" — below the 2-member minimum.
    expect(screen.getByText(`1 / ${SKILLSET_MAX_MEMBERS}`)).toBeInTheDocument();
  });

  it("removes a member via its chip × button", () => {
    const onChange = vi.fn();
    render(wrap(<SkillsetMemberPicker members={["a@1.0", "b@1.0"]} onChange={onChange} />));
    fireEvent.click(screen.getByRole("button", { name: /Remove a@1.0/ }));
    expect(onChange).toHaveBeenCalledWith(["b@1.0"]);
  });
});
