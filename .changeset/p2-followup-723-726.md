---
"ornn-web": patch
---

P2 follow-up: notifications page can scroll past the viewport and Registry semantic search with an empty query shows an actionable validation message instead of the generic empty state (#723, #726).

- **#723** — `RootLayout`'s `<main>` is `overflow-hidden`; `NotificationsPage` had no own scroll container, so once the list exceeded the viewport, older notifications were clipped and unreachable via wheel/touch scroll. Wrapped the page body in an `h-full overflow-y-auto` shell — same pattern `UploadSkillPage` uses for the same root-layout constraint.

- **#726** — Registry's semantic-search button could flip on while the input was empty; the backend correctly returned `400 QUERY_REQUIRED` but `ExplorePage` rendered the regular "No public skills match" empty state, indistinguishable from a legitimate zero-result search. Added a `semanticGateUnmet = mode === "semantic" && !query.trim()` check that swaps the empty state for an `EmptyState` with explicit copy: `Enter a search description / Semantic search needs a description of what you're looking for. Type a phrase in the search box above, or switch back to Keyword mode.` (+ Chinese translation). The backend queries keep firing (cheap, cached) but the user sees a clear validation hint instead of a misleading null result.
