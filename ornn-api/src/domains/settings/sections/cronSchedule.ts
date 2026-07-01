/**
 * Shared cron-expression Zod validator for settings sections.
 *
 * Extracted from `sections/mirror.ts` so multiple scheduled-work sections
 * (mirror reconcile, source-sync poll, …) validate their cron field the
 * same way instead of copy-pasting the refine.
 *
 * An empty string means "disabled" and is always accepted. A non-empty
 * value must parse under `cron-parser` (which accepts both 5-field UNIX
 * and 6-field with-seconds forms — either is fine for our schedulers).
 *
 * @module domains/settings/sections/cronSchedule
 */
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";

export const cronSchedule = z
  .string()
  .refine(
    (s) => {
      if (s.length === 0) return true;
      try {
        CronExpressionParser.parse(s);
        return true;
      } catch {
        // Intentional silent (#579): the false return becomes a Zod
        // validation error with the message below — that's the
        // user-facing signal. Logging the cron-parser exception would
        // be noisy on every form-validation typo.
        return false;
      }
    },
    { message: "must be a valid cron expression or empty (disabled)" },
  );
