/**
 * Skill version utility.
 *
 * Ornn uses a 2-digit version format (`<major>.<minor>`) declared in each
 * skill's SKILL.md frontmatter. This module parses and compares those
 * strings; all version-related operations in the skill CRUD path go
 * through here so the rules stay in one place.
 *
 * @module domains/skillCrud/version
 */

import { AppError } from "../../shared/types/index";
import { SKILL_VERSION_REGEX } from "../../shared/schemas/skillFrontmatter";

export interface ParsedVersion {
  major: number;
  minor: number;
}

/**
 * Parse a `<major>.<minor>` version string. Throws AppError.badRequest on
 * any malformed input (including leading zeroes, 3-digit semver, whitespace,
 * or non-numeric parts).
 */
export function parseVersion(raw: string): ParsedVersion {
  if (typeof raw !== "string") {
    throw AppError.badRequest("INVALID_VERSION", `version must be a string, got ${typeof raw}`);
  }
  const match = raw.match(SKILL_VERSION_REGEX);
  if (!match) {
    throw AppError.badRequest(
      "INVALID_VERSION",
      `version "${raw}" is invalid — expected "<major>.<minor>" (non-negative integers, no leading zeroes, no patch digit)`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

/**
 * Standard 3-way compare: returns -1 if a < b, 0 if equal, 1 if a > b.
 * Major takes precedence; only consults minor on major tie.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }
  return 0;
}

/** Strict greater-than: `a > b`. Equality returns false. */
export function isGreater(a: ParsedVersion, b: ParsedVersion): boolean {
  return compareVersions(a, b) > 0;
}
