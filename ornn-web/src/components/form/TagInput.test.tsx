/**
 * TagInput tests — pins the #650 / #653 duplicate-handling contract.
 *
 * What we lock in:
 *   1. Adding a fresh tag commits and clears the input.
 *   2. A duplicate is rejected, the input is cleared, AND an
 *      `Already added` message renders (the bug was: silent reject
 *      + stale input concatenating onto the next keystroke).
 *   3. Typing after the duplicate clears the error so it never
 *      blocks editing.
 *   4. Empty / whitespace-only submissions are silently ignored.
 *
 * @module components/form/TagInput.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagInput } from "./TagInput";

function setup(initial: string[] = []) {
  const onChange = vi.fn();
  const utils = render(<TagInput tags={initial} onChange={onChange} />);
  const input = utils.container.querySelector("input")!;
  return { onChange, input, ...utils };
}

describe("TagInput", () => {
  it("adds a new tag on Enter and clears the input", () => {
    const { onChange, input } = setup([]);
    fireEvent.change(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["alpha"]);
    expect(input.value).toBe("");
  });

  it("rejects a duplicate, clears the input, AND surfaces 'Already added'", () => {
    // #650 — input must be cleared so the next keystroke doesn't
    // concatenate onto the rejected value.
    // #653 — the rejection must be visible to the user.
    const { onChange, input } = setup(["alpha"]);
    fireEvent.change(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(screen.getByText("Already added")).toBeInTheDocument();
  });

  it("normalizes case + whitespace before the duplicate check", () => {
    const { onChange, input } = setup(["alpha"]);
    fireEvent.change(input, { target: { value: "  ALPHA  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Already added")).toBeInTheDocument();
  });

  it("clears the transient error as soon as the user keeps typing", () => {
    const { input } = setup(["alpha"]);
    fireEvent.change(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Already added")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "b" } });
    expect(screen.queryByText("Already added")).not.toBeInTheDocument();
  });

  it("silently ignores empty / whitespace-only Enter", () => {
    const { onChange, input } = setup([]);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(screen.queryByText("Already added")).not.toBeInTheDocument();
  });

  it("commits on comma too (parity with Enter)", () => {
    const { onChange, input } = setup([]);
    fireEvent.change(input, { target: { value: "beta" } });
    fireEvent.keyDown(input, { key: "," });
    expect(onChange).toHaveBeenCalledWith(["beta"]);
    expect(input.value).toBe("");
  });

  it("Backspace on empty input removes the last tag", () => {
    const { onChange, input } = setup(["alpha", "beta"]);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith(["alpha"]);
  });
});
