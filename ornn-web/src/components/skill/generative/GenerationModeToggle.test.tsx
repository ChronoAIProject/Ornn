/**
 * UT-WEB-GENERATION-MODE-TOGGLE-001 (#1242)
 *
 * Pins the SIMPLE | ADVANCED segmented control: ARIA radiogroup
 * semantics, click + arrow-key selection (which also moves focus, or
 * the roving tabindex would strand the keyboard user), and the
 * disabled lock used while streaming.
 *
 * @module components/skill/generative/GenerationModeToggle.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GenerationModeToggle } from "./GenerationModeToggle";

afterEach(() => cleanup());

function radios() {
  return screen.getAllByRole("radio") as HTMLButtonElement[];
}

describe("GenerationModeToggle", () => {
  it("renders a labelled radiogroup with Simple and Advanced segments", () => {
    render(<GenerationModeToggle value="advanced" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Generation mode" });
    expect(group).toBeInTheDocument();
    const [simple, advanced] = radios();
    expect(simple).toHaveTextContent("Simple");
    expect(advanced).toHaveTextContent("Advanced");
    expect(simple).toHaveAttribute("aria-checked", "false");
    expect(advanced).toHaveAttribute("aria-checked", "true");
    // Each segment explains itself for screen readers and via title.
    expect(simple).toHaveAttribute("title", "SKILL.md only — no scripts, references or assets");
    expect(advanced.getAttribute("aria-label")).toContain("scripts, references and assets");
  });

  it("marks only the selected segment with the ember treatment", () => {
    render(<GenerationModeToggle value="simple" onChange={() => {}} />);
    const [simple, advanced] = radios();
    expect(simple.className).toContain("border-accent");
    expect(simple.className).toContain("text-accent");
    expect(advanced.className).toContain("border-transparent");
    expect(advanced.className).not.toContain("text-accent");
  });

  it("clicking the other segment calls onChange; clicking the selected one does not", () => {
    const onChange = vi.fn();
    render(<GenerationModeToggle value="advanced" onChange={onChange} />);
    const [simple, advanced] = radios();
    fireEvent.click(advanced);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(simple);
    expect(onChange).toHaveBeenCalledWith("simple");
  });

  it("uses a roving tabindex so only the selected segment is tabbable", () => {
    render(<GenerationModeToggle value="simple" onChange={() => {}} />);
    const [simple, advanced] = radios();
    expect(simple.tabIndex).toBe(0);
    expect(advanced.tabIndex).toBe(-1);
  });

  it("arrow keys move the selection and wrap around", () => {
    const onChange = vi.fn();
    const { rerender } = render(<GenerationModeToggle value="simple" onChange={onChange} />);
    const group = screen.getByRole("radiogroup");

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("advanced");

    // From simple, Left wraps to advanced — a distinct call, not the previous one.
    onChange.mockClear();
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("advanced");

    rerender(<GenerationModeToggle value="advanced" onChange={onChange} />);
    onChange.mockClear();
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("simple");

    onChange.mockClear();
    fireEvent.keyDown(group, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("simple");
  });

  it("arrow keys move focus to the newly selected segment (roving tabindex)", () => {
    const onChange = vi.fn();
    render(<GenerationModeToggle value="simple" onChange={onChange} />);
    const [simple, advanced] = radios();
    simple.focus();
    expect(document.activeElement).toBe(simple);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(advanced);
  });

  it("ignores unrelated keys", () => {
    const onChange = vi.fn();
    render(<GenerationModeToggle value="simple" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled locks clicks and arrow keys and dims the group", () => {
    const onChange = vi.fn();
    render(<GenerationModeToggle value="advanced" onChange={onChange} disabled />);
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-disabled", "true");
    expect(group.className).toContain("opacity-40");
    const [simple] = radios();
    expect(simple).toBeDisabled();
    fireEvent.click(simple);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
