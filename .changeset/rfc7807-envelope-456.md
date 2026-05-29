---
"ornn-api": minor
"ornn-web": patch
"@chronoai/ornn-sdk": minor
---

**BREAKING:** error responses now ship as RFC 7807 `application/problem+json` per CONVENTIONS.md §1.3 (#456). The legacy `{ data: null, error: { code, message } }` envelope is gone on error paths; the fields live at the body root now:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#skill_not_found",
  "title": "Resource not found",
  "status": 404,
  "detail": "Skill 'foo' not found",
  "instance": "/v1/skills/foo",
  "code": "skill_not_found",
  "requestId": "req_01HXYZ..."
}
```

Success responses keep the `{ data, error: null }` envelope — only errors change.

`buildProblemJsonBody` helper added to `shared/types/index.ts`; bootstrap and every per-domain test stub use it so wire shape can never drift between dev and CI. Both SDKs (TS + Python) and `ornn-web`'s `apiClient` parse the new shape; error tests across all three pin the new fixture.
