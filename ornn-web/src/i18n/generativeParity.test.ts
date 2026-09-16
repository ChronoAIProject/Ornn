/**
 * i18n parity for the `generative` namespace (#1242).
 *
 * The global react-i18next test stub resolves keys against en.json only,
 * so a key added to en.json but not zh.json passes every component test
 * and only shows up as raw English in the zh UI. This pins the two
 * locales to identical key sets for the generative page, the way
 * skillsetParity.test.ts does for the skillset namespaces.
 *
 * @module i18n/generativeParity.test
 */

import { describe, it, expect } from "vitest";
import en from "./en.json";
import zh from "./zh.json";

const NAMESPACE = "generative";

type Json = Record<string, unknown>;

/** Recursively flatten a nested object into dot-joined leaf keys. */
function flatten(obj: Json, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Json, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

const enFlat = flatten(en as Json);
const zhFlat = flatten(zh as Json);

function namespaceKeys(flat: Record<string, string>): string[] {
  return Object.keys(flat)
    .filter((k) => k.startsWith(`${NAMESPACE}.`))
    .sort();
}

describe("generative i18n parity", () => {
  it("has identical key sets in en + zh", () => {
    expect(namespaceKeys(zhFlat)).toEqual(namespaceKeys(enFlat));
  });

  it("carries the mode-toggle keys (#1242)", () => {
    for (const key of [
      "modeLabel",
      "modeAria",
      "modeSimple",
      "modeAdvanced",
      "modeSimpleHint",
      "modeAdvancedHint",
    ]) {
      expect(enFlat[`${NAMESPACE}.${key}`], `en ${key}`).toBeTruthy();
      expect(zhFlat[`${NAMESPACE}.${key}`], `zh ${key}`).toBeTruthy();
    }
  });

  it("no generative string is empty in either locale", () => {
    for (const k of namespaceKeys(enFlat)) {
      expect(enFlat[k]?.trim().length, `en ${k}`).toBeGreaterThan(0);
      expect(zhFlat[k]?.trim().length, `zh ${k}`).toBeGreaterThan(0);
    }
  });
});
