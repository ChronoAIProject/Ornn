/**
 * ConfirmDialog — Forge Workshop replacement for `window.confirm()`.
 *
 * Drop-in for any "are you sure?" gating. Built on top of the `Modal`
 * primitive so it inherits the backdrop fade, spring entry,
 * `card-impression` letterpress surface, hairline border, ESC + backdrop
 * dismissal, and Space Grotesk display title — i.e., the same popup
 * vocabulary the rest of the app uses. The browser-native confirm
 * dialog ("…says…" + OS-rendered buttons) is explicitly NOT used
 * anywhere in the platform.
 *
 * Declarative, not imperative: callers track a `pendingX` state for the
 * row awaiting confirmation, render the dialog with `isOpen={pending !==
 * null}`, and clear that state on confirm / cancel. The mutation runs
 * inside `onConfirm`; pass `isLoading` while it's in flight to disable
 * Cancel and put a spinner on the Confirm button. The dialog itself
 * never owns the mutation — keeping it stateless means it nests cleanly
 * inside whatever loading / error orchestration the page already has
 * (toast store, React Query, etc.).
 *
 * @module components/ui/ConfirmDialog
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  isOpen: boolean;
  /** Fires on Cancel button, backdrop click, and ESC. */
  onClose: () => void;
  /** Fires on the Confirm button. Cleared by the caller. */
  onConfirm: () => void;
  /** Display heading — short noun phrase ("Delete announcement?"). */
  title: string;
  /** Body text under the title. Plain string or rich node. */
  description?: ReactNode;
  /** Override the Confirm button label. Defaults to `common.confirm`. */
  confirmLabel?: string;
  /** Override the Cancel button label. Defaults to `common.cancel`. */
  cancelLabel?: string;
  /**
   * Confirm-button color. `"danger"` paints the danger token (destructive
   * actions: delete, invalidate). `"primary"` paints ember accent
   * (constructive: publish, send).
   */
  variant?: "primary" | "danger";
  /**
   * When `true`, Confirm shows a spinner and Cancel is disabled. The
   * dialog can still be dismissed via ESC / backdrop — the in-flight
   * mutation continues independently and the calling page surfaces the
   * outcome via toast.
   */
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "primary",
  isLoading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {description !== undefined && description !== null && (
        <div className="font-text text-[15px] leading-relaxed text-body">
          {description}
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={isLoading}
        >
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button
          variant={variant}
          onClick={onConfirm}
          loading={isLoading}
        >
          {confirmLabel ?? t("common.confirm")}
        </Button>
      </div>
    </Modal>
  );
}
