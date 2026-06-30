/**
 * i18n key-symmetry guard for the skillset namespaces (#1059).
 *
 * Every skillset UI string is keyed under a `skillset*` namespace (plus the
 * two new `nav.*` entries) and MUST exist in BOTH en.json and zh.json with the
 * exact same key set. This test recursively flattens both locale files and
 * asserts: (a) the skillset namespaces are present in both, (b) the flattened
 * key sets are identical for those namespaces, and (c) no value is left empty.
 *
 * Catches the classic drift where a key is added to en.json and forgotten in
 * zh.json (or vice versa).
 *
 * @module i18n/skillsetParity.test
 */

import { describe, it, expect } from "vitest";
import en from "./en.json";
import zh from "./zh.json";

/** The skillset namespaces introduced by #1059. */
const SKILLSET_NAMESPACES = [
  "skillsetKind",
  "skillsetExplore",
  "skillsetDetail",
  "skillsetForm",
  "skillsetPluginExport",
  "skillsetNew",
  "skillsetEdit",
  "skillsetMembers",
  "skillsetPrompt",
  "skillsetClosure",
  "skillsetGraph",
  "skillsetPermissions",
] as const;

/** The new nav entries. */
const NAV_KEYS = ["skillsets", "mySkillsets"] as const;

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

function namespaceKeys(flat: Record<string, string>, ns: string): string[] {
  return Object.keys(flat)
    .filter((k) => k === ns || k.startsWith(`${ns}.`))
    .sort();
}

describe("skillset i18n parity", () => {
  it.each(SKILLSET_NAMESPACES)("'%s' namespace exists in both locales", (ns) => {
    expect(namespaceKeys(enFlat, ns).length).toBeGreaterThan(0);
    expect(namespaceKeys(zhFlat, ns).length).toBeGreaterThan(0);
  });

  it.each(SKILLSET_NAMESPACES)("'%s' has identical key sets in en + zh", (ns) => {
    expect(namespaceKeys(zhFlat, ns)).toEqual(namespaceKeys(enFlat, ns));
  });

  it("the new nav keys exist in both locales", () => {
    for (const key of NAV_KEYS) {
      expect(enFlat[`nav.${key}`]).toBeTruthy();
      expect(zhFlat[`nav.${key}`]).toBeTruthy();
    }
  });

  it("no skillset string is empty in either locale", () => {
    for (const ns of SKILLSET_NAMESPACES) {
      for (const k of namespaceKeys(enFlat, ns)) {
        expect(enFlat[k]?.trim().length, `en ${k}`).toBeGreaterThan(0);
        expect(zhFlat[k]?.trim().length, `zh ${k}`).toBeGreaterThan(0);
      }
    }
  });
});
