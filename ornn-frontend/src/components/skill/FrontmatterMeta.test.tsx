import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FrontmatterMeta } from "./FrontmatterMeta";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial, animate, exit, transition, ...rest } = props as Record<string, unknown>;
      void initial; void animate; void exit; void transition;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>;
    },
  },
}));

vi.mock("@/components/ui/Badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}));

const CONTENT_WITH_OLD_FRONTMATTER = `---
name: test-skill
description: A test skill
tools:
  - Bash
  - Write
dependencies:
  - lodash
env:
  - API_KEY
---

# Test Skill
`;

const CONTENT_WITH_NEW_FRONTMATTER = `---
name: test-skill
description: A test skill
metadata:
  category: tool-based
  tool-list:
    - Bash
    - Write
  runtime-dependency:
    - lodash
  runtime-env-var:
    - API_KEY
---

# Test Skill
`;

describe("FrontmatterMeta", () => {
  it("renders_withOldFlatFrontmatter_displaysToolsAndDeps", () => {
    render(<FrontmatterMeta content={CONTENT_WITH_OLD_FRONTMATTER} />);

    expect(screen.getByText("Required Tools")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText("lodash")).toBeInTheDocument();
    expect(screen.getByText("Environment Variables")).toBeInTheDocument();
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
  });

  it("renders_withNewNestedFrontmatter_displaysToolsAndDeps", () => {
    render(<FrontmatterMeta content={CONTENT_WITH_NEW_FRONTMATTER} />);

    expect(screen.getByText("Required Tools")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText("lodash")).toBeInTheDocument();
    expect(screen.getByText("Environment Variables")).toBeInTheDocument();
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
  });

  it("renders_noFrontmatter_returnsNull", () => {
    const { container } = render(<FrontmatterMeta content="# Just markdown" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders_emptyMetadata_returnsNull", () => {
    const content = `---
name: empty
description: nothing
metadata:
  category: plain
---

# Empty
`;
    const { container } = render(<FrontmatterMeta content={content} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders_withCompatibility_displaysSection", () => {
    const content = `---
name: compat-skill
description: Has compatibility
compatibility: claude-code >= 1.0
metadata:
  category: runtime-based
  runtime:
    - node
---

# Compat
`;
    render(<FrontmatterMeta content={content} />);

    expect(screen.getByText("Compatibility")).toBeInTheDocument();
    expect(screen.getByText("claude-code >= 1.0")).toBeInTheDocument();
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("node")).toBeInTheDocument();
  });
});
