/**
 * Shared GitHub owner/repo naming validation.
 *
 * Single source of truth for the GitHub identifier charset + length rules
 * so the mirror routes, the mirror settings section, and the repo-pull
 * path all enforce the same shape.
 *
 *   owner: alphanumeric + dashes; can't start or end with a dash; 1–39 chars.
 *   repo:  alphanumeric + dot/dash/underscore; 1–100 chars.
 *
 * Note: passing the charset/length regexes does NOT mean an identifier is
 * safe to splice into a filesystem path or URL — a `repo` segment can be
 * `..` or `.` and still match `REPO_RE`. Callers that build paths must
 * additionally reject path-traversal segments via {@link hasUnsafeSegment}.
 *
 * @module shared/githubNaming
 */

export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * True when any slash-delimited segment of `s` is a path-traversal or
 * hidden-segment hazard: exactly `.`/`..`, or starts/ends with a dot
 * (e.g. `.hidden`, `trail.`). Use this to reject identifiers that would
 * otherwise pass the charset regexes but are unsafe to splice into a
 * filesystem path.
 */
export function hasUnsafeSegment(s: string): boolean {
  return s
    .split("/")
    .some(
      (seg) =>
        seg === "." ||
        seg === ".." ||
        seg.startsWith(".") ||
        seg.endsWith("."),
    );
}
