---
"ornn-web": minor
---

feat: SkillDetailPage gets a full-width "Skill pulls" chart at the top (#187). New `UsagePullsCard` component renders a stacked bar chart (recharts) of pull counts over a user-controlled time range (datetime-local from / to inputs) with a Hour / Day / Month bucket toggle, broken down by source (api / web / playground). Default window: last 7 days, day buckets. Empty / invalid-range states render gracefully. Wired into SkillDetailPage between the GitHub origin chip and the Package Contents grid; respects the currently selected skill version. Added `recharts@3.x` as a dependency. en/zh i18n keys added.
