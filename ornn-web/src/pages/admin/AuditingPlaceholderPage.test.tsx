/**
 * UT-WEB-AUDITING-STUB-001 — placeholder copy + telemetry/activities links.
 *
 * @module pages/admin/AuditingPlaceholderPage.test
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuditingPlaceholderPage } from "./AuditingPlaceholderPage";

describe("AuditingPlaceholderPage", () => {
  it("renders 'coming soon' + links to settings/telemetry and activities", () => {
    render(
      <MemoryRouter>
        <AuditingPlaceholderPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Auditing dashboard isn't ready yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Telemetry settings/i }),
    ).toHaveAttribute("href", "/admin/settings/telemetry");
    expect(
      screen.getByRole("link", { name: /Activities log/i }),
    ).toHaveAttribute("href", "/admin/activities");
  });
});
