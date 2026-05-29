---
"ornn-api": patch
"ornn-web": patch
---

Stale share-target grants are now visible-but-flagged in the Permissions modal, and `skill-search?scope=shared-with-me` defensively drops results pointing at orgs the caller is no longer in (#720).

**Backend (`SearchService.search`):** after `enrichItem` builds the items, when `scope === "shared-with-me"` a zero-trust pass drops any item whose `myAccessReason === "shared-via-org"` but whose `sharedViaOrgId` isn't in the caller's current `userOrgIds`. `applyScope` already gates this at the DB layer, so this is defence-in-depth against cache lag / partially-replicated writes / future query regressions — and a `warn`-level Pino entry tags any drop so data drift is visible.

**Frontend (`PermissionsModal`):**

- Orgs: `fetchOrgSummary` previously back-filled a `null` lookup with the raw org id as the display name, silently hiding the staleness. Now each entry carries `isUnresolved: boolean` (true when NyxID can't resolve the id). Unresolved rows render with a warning-toned row background, an "unresolved" badge with a triangle icon, and a tooltip pointing the owner at the uncheck box to revoke. Click-to-revoke flows through the existing `toggleOrg` path.
- Users: when `resolveUsers` doesn't return a row for an id, the placeholder `{ userId, email: "", displayName: userId }` survives — that signal now drives a danger-toned chip + triangle icon + tooltip explaining the user is gone, with the existing `×` button revoking.

Net effect: owners see exactly what they've granted, see which grants point at entities that no longer resolve, and can clean them up in two clicks. The `skill-search` zero-trust filter ensures the calling user never sees a shared-with-me skill they can't actually open even if the underlying DB / cache disagrees with effective org membership.
