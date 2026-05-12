---
"ornn-web": minor
---

Fold the skill-detail install flow into a single tabbed card. New `SkillInstallCard` replaces the old `MirrorInstallCard` ("Install via npx") + the "Install skill to my agent" three-dots menu item with two tabs: **Via prompt** (LLM-paste-ready install instruction, always available) and **Via npx** (mirror `npx skills add ...` command, available when the deployment has the GitHub mirror configured and the skill is public). The three-dots menu is removed; **Edit skill** (owner-only) and **Download package** (when the raw ZIP is available) become small icon buttons next to the existing GitHub icon.
