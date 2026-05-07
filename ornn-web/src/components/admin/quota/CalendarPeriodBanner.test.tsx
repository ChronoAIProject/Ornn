/**
 * UT-WEB-QUOTABANNER-001 / 002 — period label + UTC stamp.
 *
 * @module components/admin/quota/CalendarPeriodBanner.test
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarPeriodBanner } from "./CalendarPeriodBanner";

describe("CalendarPeriodBanner", () => {
  it("labels start and end in UTC YYYY-MM-DD", () => {
    render(
      <CalendarPeriodBanner
        monthStart="2026-05-01T00:00:00.000Z"
        monthEnd="2026-06-01T00:00:00.000Z"
      />,
    );
    expect(
      screen.getByRole("status", { name: /current quota period/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2026-05-01/)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it("re-renders cleanly when bounds advance to next month", () => {
    const { rerender } = render(
      <CalendarPeriodBanner
        monthStart="2026-05-01T00:00:00.000Z"
        monthEnd="2026-06-01T00:00:00.000Z"
      />,
    );
    rerender(
      <CalendarPeriodBanner
        monthStart="2026-06-01T00:00:00.000Z"
        monthEnd="2026-07-01T00:00:00.000Z"
      />,
    );
    expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-01/)).toBeInTheDocument();
  });
});
