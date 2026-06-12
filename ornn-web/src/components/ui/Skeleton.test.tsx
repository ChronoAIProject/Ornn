/**
 * Skeleton wrapper tests (#886).
 *
 * Skeleton.tsx is a thin backward-compat layer over NeonSkeleton:
 *   - `Skeleton` renders a full-width NeonSkeleton and forwards
 *     `lines` + `className`.
 *   - `SkeletonCard` renders the SkillCardSkeleton composite.
 *
 * These tests pin the forwarding contract so the wrapper can't silently
 * stop passing props through to the base component.
 *
 * @module components/ui/Skeleton.test
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton, SkeletonCard } from "./Skeleton";

function shimmerNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".skeleton-shimmer"));
}

describe("Skeleton", () => {
  it("renders a single full-width shimmer line by default", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("skeleton-shimmer");
    // size="full" -> 100% width
    expect(el.style.width).toBe("100%");
  });

  it("forwards `lines` into the multi-line branch", () => {
    const { container } = render(<Skeleton lines={3} />);
    expect(shimmerNodes(container)).toHaveLength(3);
  });

  it("forwards `className` onto the rendered skeleton", () => {
    const { container } = render(<Skeleton className="passed-through" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("passed-through");
  });

  it("forwards both `lines` and `className` onto the multi-line wrapper", () => {
    const { container } = render(<Skeleton lines={2} className="multi" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("multi");
    expect(shimmerNodes(container)).toHaveLength(2);
  });
});

describe("SkeletonCard", () => {
  it("renders the SkillCardSkeleton composite", () => {
    const { container } = render(<SkeletonCard />);
    // SkillCardSkeleton renders 9 shimmer leaves (see NeonSkeleton.test).
    expect(shimmerNodes(container)).toHaveLength(9);
  });

  it("forwards `className` onto the card wrapper", () => {
    const { container } = render(<SkeletonCard className="card-passed" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("card-passed");
  });
});
