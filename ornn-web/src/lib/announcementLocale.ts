/**
 * Locale resolution for bilingual announcement content.
 *
 * Each announcement carries an `*En` and `*Zh` slot per text field
 * (`title`, `bodyMarkdown`, `ctaLabel`). EN is canonical / required;
 * ZH is optional. The user-facing render picks the active locale's
 * slot if it has content, else falls back to EN.
 *
 * Rule, in one line:
 *
 *     i18n.language.startsWith("zh") && zh.trim()  →  zh
 *     otherwise                                    →  en
 *
 * Matching `startsWith("zh")` rather than equality covers all the BCP
 * 47 variants i18next may serve (`zh`, `zh-CN`, `zh-Hant`, …).
 *
 * @module lib/announcementLocale
 */

/**
 * Pick the user-facing string from an EN/ZH pair. Pass the active
 * i18n language (e.g. `i18n.language` from `useTranslation()`).
 */
export function pickLocalized(en: string, zh: string, lang: string | undefined | null): string {
  const tag = (lang ?? "").toLowerCase();
  if (tag.startsWith("zh") && zh.trim().length > 0) return zh;
  return en;
}

/**
 * Pick a localized CTA label. Treats `null` and empty/whitespace-only
 * strings as "not set" — callers only render a CTA when this returns
 * a non-empty string AND a non-null `ctaUrl`.
 */
export function pickLocalizedCtaLabel(
  en: string | null,
  zh: string | null,
  lang: string | undefined | null,
): string | null {
  const tag = (lang ?? "").toLowerCase();
  if (tag.startsWith("zh") && zh && zh.trim().length > 0) return zh;
  if (en && en.trim().length > 0) return en;
  return null;
}
