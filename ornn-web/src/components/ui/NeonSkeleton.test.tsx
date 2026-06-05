/**
 * NeonSkeleton tests — exercises every branch of the base skeleton and
 * the SkillCardSkeleton composite (#886).
 *
 * The base component has a handful of independent branches that are easy
 * to silently break during a refactor:
 *   1. variant -> rounding class (text / circular / rectangular / rounded)
 *   2. size presets vs explicit width/height
 *   3. numeric width/height -> "{n}px" coercion vs string pass-through
 *   4. the multi-line branch (lines > 1 && variant === "text") which
 *      renders N children and forces the last line to 75% width
 *   5. animate=false -> static bg instead of the shimmer class
 *
 * SkillCardSkeleton is a pure composite — we assert it renders the
 * expected number of child skeleton elements so a structural change is
 * caught.
 *
 * @module components/ui/NeonSkeleton.test
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NeonSkeleton, SkillCardSkeleton } from "./NeonSkeleton";

/** All shimmer skeleton leaves carry the `skeleton-shimmer` class. */
function shimmerNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".skeleton-shimmer"));
}

describe("NeonSkeleton (base)", () => {
  it("defaults to the text variant with the md size preset", () => {
    const { container } = render(<NeonSkeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("skeleton-shimmer");
    expect(el.className).toContain("rounded-md"); // text variant
    // md preset
    expect(el.style.width).toBe("8rem");
    expect(el.style.height).toBe("1.25rem");
  });

  it.each([
    ["text", "rounded-md"],
    ["circular", "rounded-full"],
    ["rectangular", "rounded-none"],
    ["rounded", "rounded"],
  ] as const)("variant=%s applies the %s rounding class", (variant, cls) => {
    const { container } = render(<NeonSkeleton variant={variant} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain(cls);
  });

  it.each([
    ["sm", "4rem", "1rem"],
    ["md", "8rem", "1.25rem"],
    ["lg", "12rem", "1.5rem"],
    ["full", "100%", "1rem"],
  ] as const)("size=%s resolves to the %s x %s preset", (size, w, h) => {
    const { container } = render(<NeonSkeleton size={size} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe(w);
    expect(el.style.height).toBe(h);
  });

  it("coerces numeric width/height to pixel strings", () => {
    const { container } = render(<NeonSkeleton width={32} height={48} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("32px");
    expect(el.style.height).toBe("48px");
  });

  it("passes string width/height through verbatim (no px coercion)", () => {
    const { container } = render(<NeonSkeleton width="60%" height="2rem" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("60%");
    expect(el.style.height).toBe("2rem");
  });

  it("explicit width/height override the size preset", () => {
    const { container } = render(
      <NeonSkeleton size="sm" width="90%" height="3rem" />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("90%");
    expect(el.style.height).toBe("3rem");
  });

  it("applies a custom className on the single-line branch", () => {
    const { container } = render(<NeonSkeleton className="custom-cls" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("custom-cls");
  });

  it("animate=false swaps the shimmer class for a static background", () => {
    const { container } = render(<NeonSkeleton animate={false} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).not.toContain("skeleton-shimmer");
    expect(el.className).toContain("bg-elevated/40");
  });

  describe("multi-line branch (lines > 1 && text)", () => {
    it("renders one shimmer child per line and a wrapper className", () => {
      const { container } = render(
        <NeonSkeleton lines={3} className="multi-wrap" />,
      );
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain("flex flex-col");
      expect(wrapper.className).toContain("multi-wrap");
      expect(shimmerNodes(container)).toHaveLength(3);
    });

    it("forces the last line to 75% width and keeps earlier lines at the resolved width", () => {
      const { container } = render(<NeonSkeleton lines={4} width="200px" />);
      const lines = shimmerNodes(container);
      expect(lines).toHaveLength(4);
      // First three lines keep the coerced width...
      expect(lines[0].style.width).toBe("200px");
      expect(lines[1].style.width).toBe("200px");
      expect(lines[2].style.width).toBe("200px");
      // ...and the final line is shortened to 75%.
      expect(lines[3].style.width).toBe("75%");
    });

    it("does NOT take the multi-line branch for non-text variants", () => {
      // lines > 1 but variant !== text -> single-element branch.
      const { container } = render(
        <NeonSkeleton lines={3} variant="rounded" />,
      );
      expect(shimmerNodes(container)).toHaveLength(1);
    });
  });
});

describe("SkillCardSkeleton (composite)", () => {
  it("renders the expected child skeleton leaves", () => {
    const { container } = render(<SkillCardSkeleton />);
    // Header (2) + description multi-line (2) + tags (3) + footer (2) = 9.
    expect(shimmerNodes(container)).toHaveLength(9);
  });

  it("forwards a custom className onto the card wrapper", () => {
    const { container } = render(<SkillCardSkeleton className="card-cls" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("card-cls");
  });
});
