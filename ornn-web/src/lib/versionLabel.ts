/**
 * Human-readable label for a version entry in the picker / list.
 * Pure, side-effect-free — trivially unit-testable.
 *
 *   formatVersionLabel("1.2", { isLatest: true,  isDeprecated: false }) // "1.2 · latest"
 *   formatVersionLabel("1.0", { isLatest: false, isDeprecated: true  }) // "1.0 · deprecated"
 *   formatVersionLabel("1.1", { isLatest: true,  isDeprecated: true  }) // "1.1 · latest · deprecated"
 */

export interface VersionLabelFlags {
  isLatest?: boolean;
  isDeprecated?: boolean;
  latestText?: string;
  deprecatedText?: string;
}

export function formatVersionLabel(version: string, flags: VersionLabelFlags = {}): string {
  const parts = [version];
  if (flags.isLatest) parts.push(flags.latestText ?? "latest");
  if (flags.isDeprecated) parts.push(flags.deprecatedText ?? "deprecated");
  return parts.join(" · ");
}
