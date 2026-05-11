/**
 * UnsavedChangesGuard — react-router useBlocker wrapper.
 *
 * Blocks navigation away from a settings section while the local form
 * is `dirty`. When the blocker fires, we render a styled `<Modal>`
 * confirming the discard rather than popping Chrome's native
 * `window.confirm` (#281). On Discard the blocker is `proceed()`-ed; on
 * Cancel `reset()` keeps the user on the current route.
 *
 * The `beforeunload` handler stays raw — that prompt belongs to the OS
 * shell at tab-close time and isn't styleable from the page.
 *
 * @module components/admin/settings/UnsavedChangesGuard
 */

import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

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
  const { t } = useTranslation();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
  );

  // Tab-close prompt — browser-owned, can't be styled.
  useEffect(() => {
    if (!when) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when]);

  const isBlocked = blocker.state === "blocked";

  return (
    <Modal
      isOpen={isBlocked}
      onClose={() => isBlocked && blocker.reset?.()}
      title={t("common.unsavedChanges")}
    >
      <p className="font-text text-sm text-body">{message}</p>
      <div className="mt-6 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => isBlocked && blocker.reset?.()}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => isBlocked && blocker.proceed?.()}
        >
          Discard changes
        </Button>
      </div>
    </Modal>
  );
}
