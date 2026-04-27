---
"ornn-web": patch
---

refactor: group skill-related pages under `pages/skill/` (#104). Pure file move — `CreateSkillFreePage`, `CreateSkillFromGitHubPage`, `CreateSkillGenerativePage`, `CreateSkillGuidedPage`, `EditSkillPage`, `MySkillsPage`, `SkillAuditHistoryPage`, `SkillDetailPage`, `UploadSkillPage` now live under `pages/skill/`. New `pages/skill/index.ts` barrel; `App.tsx` imports updated to use the new paths. No route or behavior change.
