---
"ornn-web": patch
---

Registry page now respects Chinese locale across every tab (#682).

Two classes of bug, both mass-bleeding English copy into the Chinese UI:

**Class 1 — keys called from source never existed in either locale file.** `ExplorePage.tsx` reads `t("explore.filterTags", "Tag")`, `t("explore.noServices", "No system services yet.")`, `t("explore.systemSkillsHint", "…")`, etc. through 14 distinct keys that were never added to `en.json` or `zh.json`. Without a matching key in either locale, i18n falls back to the second arg (the English literal) regardless of language. ZH users saw English literals everywhere. Added the missing keys to BOTH locale files. Also renamed the source's two intro paragraphs (`systemSkillsHint` → `systemSkillsIntro`, `sharedHint` → `sharedWithMeIntro`) to match the new canonical key names so future readers don't trip on the legacy fallback-only labels.

**Class 2 — literal strings never wired through i18n.** `SearchBar.tsx` had 5 hardcoded English strings (`Keyword`, `Semantic`, the two placeholders, the two `title=` tooltips). `SkillCard.tsx` had `Public`, `Private`, `Via organization`, `Shared by {name}` baked in. `Pagination.tsx` had `Prev` / `Next` baked in (used on every paginated list — Registry, admin tables, lifetime drawer). All converted to `t("…")` calls; new keys added to both locale files; `Public` / `Private` / `Prev` / `Next` reuse the existing `common.*` keys (already translated in ZH).

Net result: Registry page reads end-to-end Chinese in ZH mode — search bar, all four tabs' filter headings + empty states, skill-card badges, and pagination. Product names (`NyxID`) stay untranslated per the issue's guidance. Date formatting is not addressed here — Intl `toLocaleString` already respects the system locale on the browser side; the calling pages set their own `locale` param if they want to force `zh-CN`.

139 / 0 fail ornn-web tests; typecheck clean.
