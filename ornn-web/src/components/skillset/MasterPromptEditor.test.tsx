/**
 * MasterPromptEditor — required trimmed 1–8000 validation + char count.
 *
 * The #978 contract: the master prompt is REQUIRED, trim-then-bound so a
 * whitespace-only body is invalid, and capped at 8000 chars. The exported
 * `validateMasterPrompt` is the unit under test for the boundary cases; the
 * rendered editor surfaces a live count + over-limit warning.
 *
 * @module components/skillset/MasterPromptEditor.test
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MasterPromptEditor, validateMasterPrompt } from "./MasterPromptEditor";
import { SKILLSET_INSTRUCTIONS_MAX } from "@/types/skillset";

afterEach(() => cleanup());

describe("validateMasterPrompt", () => {
  it("rejects an empty body", () => {
    expect(validateMasterPrompt("")).toBe("empty");
  });

  it("rejects a whitespace-only body (trim-then-bound)", () => {
    expect(validateMasterPrompt("   \n\t  ")).toBe("empty");
  });

  it("rejects a body over the 8000-char cap (measured trimmed)", () => {
    expect(validateMasterPrompt("a".repeat(SKILLSET_INSTRUCTIONS_MAX + 1))).toBe("tooLong");
  });

  it("accepts a body exactly at the cap", () => {
    expect(validateMasterPrompt("a".repeat(SKILLSET_INSTRUCTIONS_MAX))).toBeNull();
  });

  it("accepts a normal body", () => {
    expect(validateMasterPrompt("Run A, then B.")).toBeNull();
  });
});

describe("MasterPromptEditor rendering", () => {
  it("shows a live trimmed character count", () => {
    render(<MasterPromptEditor value="hello" onChange={() => {}} />);
    expect(screen.getByText(`5 / ${SKILLSET_INSTRUCTIONS_MAX}`)).toBeInTheDocument();
  });

  it("surfaces an over-limit warning when past the cap", () => {
    render(
      <MasterPromptEditor value={"a".repeat(SKILLSET_INSTRUCTIONS_MAX + 5)} onChange={() => {}} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(new RegExp(String(SKILLSET_INSTRUCTIONS_MAX)));
  });

  it("surfaces an external error only when the body is empty", () => {
    render(<MasterPromptEditor value="   " onChange={() => {}} error="Prompt is required" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Prompt is required");
  });
});
