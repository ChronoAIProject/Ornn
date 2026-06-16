---
"ornn-api": minor
"ornn-web": minor
---

Manage Permissions: separate Read and Write access into two tabs.

The skill and skillset permissions editor is now a two-tab editor — a **Read** tab (Public toggle, or a restricted set of orgs/users who can read) and a **Write** tab (orgs/users who can edit). This makes every combination the backend already supports expressible, including **public read + organization/user write**, which the previous single-visibility-ladder couldn't reach. Skillsets also gain the read / read-write level support they previously lacked. No API changes — purely a UI redesign over the existing typed `grants` model.
