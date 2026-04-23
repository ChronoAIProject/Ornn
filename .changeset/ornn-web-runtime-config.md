---
"ornn-web": minor
---

Convert ornn-web config from build-time to runtime. Both the nginx upstream URLs (`NYXID_BACKEND_URL`, `ORNN_API_URL`) and the Vite-side `VITE_NYXID_*` / `VITE_API_BASE_URL` values are now injected at container startup via the new `ornn-web-config` ConfigMap instead of being baked into the image. `nginx.conf` → `nginx.conf.template` (envsubst'd by the image's built-in 20-envsubst-on-templates.sh); a new 40-envsubst-config-js.sh script generates `/config.js` from a template, which sets `window.__ORNN_CONFIG__` before the main bundle loads. A new `src/config.ts` module is the single entrypoint for config reads (falls back to `import.meta.env.VITE_*` for `bun run dev` / Vitest). `VITE_NYXID_SETTINGS_URL` was used in code but missing from the Dockerfile ARG list — now covered as part of the runtime config. Drops all `--build-arg VITE_*` from the frontend `docker build` command in CLAUDE.md; one image now runs across every environment.
