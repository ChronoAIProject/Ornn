---
"ornn-api": patch
---

`/skill-facets/system-services` now drops services NyxID has deactivated, and the NyxID catalog cache TTL drops from 60s → 10s (#715).

Background: when NyxID deactivates a service (`DELETE /api/v1/services/:id` is a soft delete that flips `is_active: false`), Ornn kept exposing it. The DB aggregation behind `/skill-facets/system-services` reads `nyxidServiceId/slug/label` straight off skill documents, so any skill ever bound to that service still surfaced the service as a usable filter chip. Per-caller paths (`/me/nyxid-services`, `/nyxid-services/:serviceId/skills`) already filtered `is_active=false` inside `NyxidServiceClient.listServicesForCaller`, but the 60-second cache widened the visibility lag after deactivation.

Fix:

- `NyxidServiceClient.listActiveServiceIdsAsPlatform(saToken)` (new): SA-token fetch of NyxID's `/services`, projected to a `Set<string>` of active service ids. Separate from the per-caller cache (one slot — SA view is uniform). Fail-soft: returns `null` on non-2xx or thrown fetch so callers preserve current behaviour when NyxID is unreachable. Same 10s TTL as the per-caller cache.
- `cacheTtlMs` lowered from `60_000` to `10_000`. After a NyxID deactivation, every Ornn surface that goes through `findVisibleToCaller` (`/me/nyxid-services`, reverse lookup) drops the service within at most 10s instead of 60s.
- `invalidateCache()` also clears the platform cache so admin-side hooks can force a refresh.
- `/skill-facets/system-services` (search/routes) now intersects the DB aggregation with the platform active set when `nyxidServiceClient` + `getSaAccessToken` are wired in; falls through to the pre-#715 raw aggregation if either is missing or the SA fetch fails. Bootstrap wires both.

Out of scope: skill detail still shows the historical `nyxidServiceId/slug/label` even when the service is deactivated. The QA report lists this as one of several acceptable mitigations; the simplest "stop misrepresenting the service as usable" path is to ensure the facet (the discovery surface) doesn't advertise it. A follow-up can mark the detail panel as "service unavailable" if we want a louder signal.

Coverage: colocated `clients/nyxid/service.test.ts` exercises the per-caller `is_active=false` drop (pre-existing defence-in-depth), missing-`is_active` default-to-active, the new platform method (SA token + URL, caching, fail-soft on 5xx and network throw, empty SA short-circuit, `invalidateCache` re-fetch). 8 tests, all green.
