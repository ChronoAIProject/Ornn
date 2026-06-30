---
"ornn-api": minor
"ornn-web": minor
---

An exported skillset now publishes its PUBLIC-member subset instead of being all-or-nothing. Previously a skillset had to be all-public to export, and a single member going private removed the whole plugin from the mirror. Now the plugin drops just the private (or unresolvable) members, keeps exporting the rest, and lists the dropped members in its README — so nothing private is ever bundled, but the public part stays available. Export is sustained only while at least two public members remain; below that the plugin is removed. The export opt-in is likewise gated on having at least two public members (not on being all-public), so a "restricted" skillset can still export its public subset. A member going private (or public again) now re-exports the affected skillsets immediately instead of waiting for the nightly reconcile. The skillset detail API surfaces a `publicMemberCount`, and the web export card gates on it, updates its hint copy ("Requires at least 2 public member skills"), and shows how many members were excluded.
