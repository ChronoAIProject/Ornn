/** SPDX license identifiers allowed for GitHub skill imports */
export const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unlicense",
]);

/** Check whether a given SPDX license ID is in the allowlist */
export function isLicenseAllowed(spdxId: string | null | undefined): boolean {
  if (!spdxId) return false;
  return ALLOWED_LICENSES.has(spdxId);
}
