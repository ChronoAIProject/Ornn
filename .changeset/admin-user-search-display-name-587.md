---
"ornn-api": patch
---

Admin Users search now matches display name as well as email (#587).

The search input's placeholder said "email or display name" but the Mongo filter only matched `email` with an anchored-prefix regex. Display names + display-name substrings were silently ignored, so admins typing `Haylee01` or `Proxy` got empty result lists even though those users existed.

Fix is additive — the email behaviour is preserved (still an anchored, case-insensitive prefix match), and a case-insensitive **substring** match on `displayName` is OR'd in alongside it. Display names don't have a meaningful prefix (the issue's reproducer was `Proxy` matching `Ornn Local Proxy`), so substring is the right shape.

Both the unbounded `findAllInRole` (the admin dashboard's paginated-in-memory path) and the paginated `listUsers` (the page-then-fetch path) use the same `buildUserSearchFilter` helper so they stay in sync.

Regex metacharacters in the query are escaped, same as before — pinned with a new test so the escape stays in place.
