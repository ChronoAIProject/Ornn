/**
 * LaunchCelebrationPopup tests.
 *
 * Locks in the load-bearing contract: the popup is hardcoded (no DB
 * dependency) and shows on every landing-page mount, even after the
 * user dismissed it on a prior visit. Closing only sets local state;
 * a re-mount must reopen it.
 *
 * @module pages/landing/LaunchCelebrationPopup.test
 */

import { describe, expect, it, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitForElementToBeRemoved,
} from "@testing-library/react";

import { LaunchCelebrationPopup } from "./LaunchCelebrationPopup";

const DISMISS_BUTTON_NAME = "Dismiss";

describe("LaunchCelebrationPopup", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders open on mount", () => {
    render(<LaunchCelebrationPopup />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("close button hides the modal", async () => {
    render(<LaunchCelebrationPopup />);
    fireEvent.click(screen.getByRole("button", { name: DISMISS_BUTTON_NAME }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
  });

  it("re-opens on remount (no persistence between visits)", async () => {
    const { unmount } = render(<LaunchCelebrationPopup />);
    fireEvent.click(screen.getByRole("button", { name: DISMISS_BUTTON_NAME }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    unmount();

    render(<LaunchCelebrationPopup />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
