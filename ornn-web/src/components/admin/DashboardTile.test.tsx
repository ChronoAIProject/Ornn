/**
 * UT-WEB-DASHTILE-001/002/003 — render / loading / error.
 *
 * @module components/admin/DashboardTile.test
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardTile } from "./DashboardTile";

describe("DashboardTile", () => {
  it("renders the formatted value", () => {
    render(<DashboardTile label="Total users" value={1234} />);
    expect(screen.getByText(/Total users/i)).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("hides the number while loading", () => {
    render(<DashboardTile label="Total users" value={undefined} isLoading />);
    expect(screen.getByText(/Total users/i)).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText(/^\d+(,\d+)*$/)).toBeNull();
  });

  it("renders an error message in place of the value", () => {
    render(
      <DashboardTile
        label="Total users"
        value={undefined}
        errorMessage="Forbidden"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Forbidden/);
  });
});
