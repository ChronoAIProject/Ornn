/**
 * AnnouncementPopup — landing-page modal that surfaces the currently
 * active announcement to every visitor (anonymous + signed-in).
 *
 * Industry-standard "what's new" pattern (Linear / Vercel / GitHub):
 *   - One-shot per announcement id. Once dismissed, that id never
 *     reappears for the same browser; admins force a re-show by
 *     creating a new announcement.
 *   - localStorage-keyed dismissal (`ornn:announcement:dismissed:<id>`).
 *     No server-side write — keeps the endpoint stateless and
 *     anonymous-friendly.
 *   - Renders nothing on the server-side until the React Query has
 *     resolved, so we don't briefly flash an empty modal frame.
 *
 * @module pages/landing/AnnouncementPopup
 */

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ReadmeViewer } from "@/components/skill/ReadmeViewer";
import { useActiveAnnouncement } from "@/hooks/useAnnouncements";

const DISMISS_KEY_PREFIX = "ornn:announcement:dismissed:";

function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + id) === "1";
  } catch {
    // Private mode / disabled storage → fall through and let the modal
    // re-render. Better to nag than to break.
    return false;
  }
}

function markDismissed(id: string): void {
  try {
    localStorage.setItem(DISMISS_KEY_PREFIX + id, "1");
  } catch {
    // No-op; see above.
  }
}

export function AnnouncementPopup() {
  const { data: announcement } = useActiveAnnouncement();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!announcement) {
      setOpen(false);
      return;
    }
    if (!isDismissed(announcement.id)) {
      setOpen(true);
    }
  }, [announcement]);

  const close = () => {
    if (announcement) markDismissed(announcement.id);
    setOpen(false);
  };

  if (!announcement) return null;

  const ctaHref = announcement.ctaUrl ?? null;
  const ctaLabel = announcement.ctaLabel ?? null;
  const isExternalCta = ctaHref ? /^https?:\/\//i.test(ctaHref) : false;

  return (
    <Modal isOpen={open} onClose={close} title={announcement.title}>
      <div className="flex flex-col gap-5">
        <div className="markdown-body text-body">
          <ReadmeViewer content={announcement.bodyMarkdown} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={close} type="button">
            Dismiss
          </Button>
          {ctaHref && ctaLabel && (
            <a
              href={ctaHref}
              target={isExternalCta ? "_blank" : undefined}
              rel={isExternalCta ? "noopener noreferrer" : undefined}
              onClick={() => {
                // Mark dismissed on CTA click so a returning user who
                // followed the link isn't asked again on next visit.
                if (announcement) markDismissed(announcement.id);
              }}
              className="inline-flex items-center justify-center rounded-sm border border-accent-muted bg-accent px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-page transition-colors hover:bg-accent-muted"
            >
              {ctaLabel}
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
