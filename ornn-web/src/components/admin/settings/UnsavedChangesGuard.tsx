/**
 * UnsavedChangesGuard — react-router useBlocker wrapper.
 *
 * Blocks navigation away from a settings section while the local form
 * is `dirty`. Confirms via window.confirm; on accept, the underlying
 * blocker is `proceed()`-ed; on reject, `reset()` keeps the user on the
 * current route. The component renders nothing — it's a side-effect
 * hook driver that lives inside the Outlet so each section opts in.
 *
 * Also installs a `beforeunload` handler so closing the tab triggers
 * the browser's native "Leave site?" prompt.
 *
 * @module components/admin/settings/UnsavedChangesGuard
 */

import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

export interface UnsavedChangesGuardProps {
  when: boolean;
  message?: string;
}

const DEFAULT_MESSAGE =
  "You have unsaved changes in this section. Discard them?";

export function UnsavedChangesGuard({
  when,
  message = DEFAULT_MESSAGE,
}: UnsavedChangesGuardProps) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      const ok = window.confirm(message);
      if (ok) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, message]);

  useEffect(() => {
    if (!when) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when]);

  return null;
}
