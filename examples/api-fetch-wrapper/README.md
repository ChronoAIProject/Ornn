# api-fetch-wrapper

Call a public HTTP API with retries, structured errors, and no-leak credential handling. Demo target is Open-Meteo (keyless, so the example runs out of the box).

**Run:** `echo '{"latitude":52.52,"longitude":13.41}' | bun run src/index.ts`

**Adapt:** swap the upstream URL + shape; add `Authorization` header reading from env. The retry-and-error-mapping skeleton is the load-bearing part — don't drop it.

See `SKILL.md` for the full contract.
