---
"ornn-web": patch
---

fix(web): make Extras section's per-row Base URL accept empty string (#279).

The admin **Extras** section's per-row `Base URL` input rejected the empty string with `Invalid url; Must be http(s)`, even though the backend (`extras.ts:optionalHttpUrl`) has always accepted it. Frontend Zod schema now matches the backend's empty-or-http(s) semantics: operators can register a service by name only and fill in the gateway later. `Scopes` was already optional; the field labels now say so explicitly.
