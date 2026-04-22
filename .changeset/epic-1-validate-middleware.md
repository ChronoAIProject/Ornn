---
"ornn-api": patch
---

Epic 1: request validation middleware (part of #66).

New `ornn-api/src/middleware/validate.ts` replaces the per-route `c.req.json() → try/catch → schema.safeParse() → throw AppError` boilerplate with declarative composition: routes receive pre-validated data via typed helpers.

```ts
app.put(
  "/skills/:id/permissions",
  auth,
  requirePermission("ornn:skill:update"),
  validateBody(permissionsPatchSchema, "INVALID_PERMISSIONS"),
  async (c) => {
    const body = getValidatedBody<z.infer<typeof permissionsPatchSchema>>(c);
    // ...
  },
);
```

Routes migrated:
- `PUT /api/skills/:id/permissions` (body)
- `PATCH /api/skills/:idOrName/versions/:version` (body)
- `GET /api/skill-search` (query)
- `POST /api/playground/chat` (body)
- `POST /api/admin/categories` (body)
- `PUT /api/admin/categories/:id` (body)
- `POST /api/admin/tags` (body)
- `GET /api/users/search` (query)

External contract preserved: each route passes its existing error code (e.g. `INVALID_PERMISSIONS`, `INVALID_DEPRECATION_PATCH`) into `validateBody` / `validateQuery`. Error responses look identical to clients. Error code catalog collapse lands in Epic 2.

Non-JSON bodies (ZIP uploads, multipart forms) keep their bespoke parsing — the middleware is `Content-Type: application/json` only.
