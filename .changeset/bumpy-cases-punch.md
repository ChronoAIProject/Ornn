---
"ornn-web": patch
---

fix(web): unbreak admin **Users** page — split sort wire payload into `sort` + `dir` (#290).

Frontend was sending `sort=lastActiveAt:desc` as a single combined query param, but the backend's Zod schema (`admin-users/routes.ts`) takes `sort=<field>` and `dir=<asc|desc>` as two separate params. The combined value bounced off the field-name enum with `Invalid enum value`, returning 500 to both Admin Users and Normal Users tables. UI table state stays on the convenient `field:dir` shape; the API client now splits before constructing the HTTP request.
