---
---

docs: Agent Manual v1 — refresh against current state and add full Chinese translation. Removes the deleted `POST /skills/:idOrName/share` endpoint, rewrites §2.2 / §3.5 / §3.6 / §6.5 / §6.6 around the post-#179 sharing flow (audit-first then `PUT /permissions`), adds owner-callable `POST /skills/:id/audit`, the running/completed/failed audit lifecycle, the `?version=` filter on audit history + analytics, the new `analytics/pulls` time-series endpoint, the new `DELETE /skills/:id/versions/:version` route, and the `/admin/settings` GET/PATCH pair. New Chinese translation lives at `ornn-web/src/docs/site/zh/agent-manual.md` and is registered in the zh `menuStructure.json`. Docs-only.
