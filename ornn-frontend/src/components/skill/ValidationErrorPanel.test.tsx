/**
 * Tests for ValidationErrorPanel component.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValidationErrorPanel } from "./ValidationErrorPanel";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: Record<string, unknown>) => {
      const {
        initial,
        animate,
        exit,
        transition,
        ...rest
      } = props as Record<string, unknown>;
      void initial;
      void animate;
      void exit;
      void transition;
      return (
        <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
          {children as React.ReactNode}
        </div>
      );
    },
  },
}));

describe("ValidationErrorPanel", () => {
  it("render_withErrors_displaysAllErrors", () => {
    const errors = [
      { field: "metadata.runtime", message: "runtime is required when category is 'runtime-based'" },
      { field: "name", message: "name must be at most 64 characters" },
    ];

    render(<ValidationErrorPanel errors={errors} />);

    expect(screen.getByText("Frontmatter Validation Errors")).toBeInTheDocument();
    expect(screen.getByText("2 errors found. Fix all errors before saving.")).toBeInTheDocument();
    expect(screen.getByText("metadata.runtime")).toBeInTheDocument();
    expect(screen.getByText("runtime is required when category is 'runtime-based'")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("name must be at most 64 characters")).toBeInTheDocument();
  });

  it("render_singleError_usesSingularText", () => {
    const errors = [
      { field: "description", message: "description is required" },
    ];

    render(<ValidationErrorPanel errors={errors} />);

    expect(screen.getByText("1 error found. Fix all errors before saving.")).toBeInTheDocument();
  });

  it("render_emptyErrors_returnsNull", () => {
    const { container } = render(<ValidationErrorPanel errors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("render_customTitle_displaysCustomTitle", () => {
    const errors = [{ field: "name", message: "invalid" }];

    render(
      <ValidationErrorPanel
        errors={errors}
        title="Upload Errors"
      />,
    );

    expect(screen.getByText("Upload Errors")).toBeInTheDocument();
  });

  it("render_emptyFieldPath_showsRoot", () => {
    const errors = [{ field: "", message: "general error" }];

    render(<ValidationErrorPanel errors={errors} />);

    expect(screen.getByText("root")).toBeInTheDocument();
  });

  it("render_hasAlertRole_forAccessibility", () => {
    const errors = [{ field: "name", message: "required" }];

    render(<ValidationErrorPanel errors={errors} />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
  });
});
