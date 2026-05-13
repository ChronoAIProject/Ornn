---
"ornn-api": patch
"ornn-web": patch
---

Bilingual announcements: admins can now author each announcement in English and Chinese together. The user-facing surfaces (landing-page popup and News tab archive) pick the variant matching the visitor's selected i18n language, falling back to English whenever the Chinese slot is empty — so half-translated records still render cleanly for Chinese visitors. Existing announcements are backfilled on first boot of the new API (legacy single-locale `title` / `bodyMarkdown` / `ctaLabel` columns are copied into both `*En` and `*Zh` slots; idempotent). Empty Chinese fields stay empty so admins can translate at their own pace without breaking the active popup. The CTA URL stays locale-independent; only the CTA label is localized.
