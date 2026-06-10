/**
 * RailCard — the shared right-rail card chrome lifted out of the skill rail
 * cards (#1067).
 *
 * @module components/detail/RailCard.test
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RailCard } from "./RailCard";

afterEach(() => {
  cleanup();
});

describe("RailCard", () => {
  it("renders the eyebrow title and the body children", () => {
    render(
      <RailCard title="Versions">
        <p>body content</p>
      </RailCard>,
    );
    expect(screen.getByRole("heading", { name: /Versions/ })).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
  });

  it("renders the optional icon and headerRight slots", () => {
    render(
      <RailCard
        title="Members"
        icon={<span data-testid="icon">i</span>}
        headerRight={<span data-testid="count">3</span>}
      >
        <div />
      </RailCard>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("applies the danger tone to the header", () => {
    render(
      <RailCard title="Danger zone" tone="danger">
        <div />
      </RailCard>,
    );
    const heading = screen.getByRole("heading", { name: /Danger zone/ });
    expect(heading.className).toContain("text-danger");
    expect(heading.className).toContain("border-danger/30");
  });

  it("defaults to the neutral tone", () => {
    render(
      <RailCard title="Metadata">
        <div />
      </RailCard>,
    );
    const heading = screen.getByRole("heading", { name: /Metadata/ });
    expect(heading.className).toContain("text-meta");
    expect(heading.className).not.toContain("text-danger");
  });
});
