---
"ornn-api": minor
---

New endpoint `POST /api/v1/skills/generate/from-source` — generates a skill by analyzing backend source code. Accepts either inline `code` or a public GitHub `repoUrl` (optional `path` subfolder). Backend fetches a small bundle of likely route files via the GitHub contents API, auto-detects the framework (Express / Hono / FastAPI / Flask / Spring Boot / Gin / …) and streams the generation via the same SSE event vocabulary as `from-openapi`. Closes #42.
