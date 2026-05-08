import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

/**
 * Build identity = `<pkg.version>+<git-short-sha>`.
 *
 * Inside docker the SHA is passed in as a build-arg → env (the
 * Dockerfile sets `VITE_GIT_COMMIT`) since the `.git` directory isn't
 * copied into the image. Locally we fall back to `git rev-parse`. If
 * neither is available (rare: tarball install, CI without git), we use
 * a build-time epoch so two builds at different moments still differ.
 *
 * Both `__APP_VERSION__` (baked into the JS bundle) and `version.json`
 * (served as a small static file by nginx) MUST resolve to this exact
 * string — they're compared at runtime by the version-check loop.
 */
function resolveBuildVersion(): string {
  const sha = (() => {
    const fromEnv = process.env.VITE_GIT_COMMIT;
    if (fromEnv && fromEnv.length > 0 && fromEnv !== "unknown") return fromEnv;
    try {
      return execSync("git rev-parse --short HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return `t${Date.now()}`;
    }
  })();
  return `${pkg.version}+${sha}`;
}

const BUILD_VERSION = resolveBuildVersion();

/**
 * Emit `dist/version.json` after build so the deployed SPA can be
 * version-checked at runtime. Sister to `__APP_VERSION__` baked into
 * the JS bundle: the two values together drive the auto-reload-on-
 * stale-bundle behavior.
 *
 * `Cache-Control: no-store` for this path is set in
 * `nginx.conf.template`.
 */
function emitVersionJsonPlugin(version: string): PluginOption {
  return {
    name: "ornn-emit-version-json",
    apply: "build",
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      writeFileSync(
        resolve(outDir, "version.json"),
        `${JSON.stringify({ version })}\n`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), emitVersionJsonPlugin(BUILD_VERSION)],
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5847,
    proxy: {
      // Single canonical proxy rule. All ornn-api traffic goes through
      // `/api/v1/*`; see `docs/conventions.md` §2.1 (versioning).
      //
      // SSE-aware: streaming endpoints (skill generation, playground chat)
      // require passthrough of `text/event-stream` headers so the browser
      // sees a live stream rather than a buffered JSON blob.
      "/api/v1": {
        target: "http://localhost:3802",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              res.setHeader("Content-Type", "text/event-stream");
              res.setHeader("Cache-Control", "no-cache");
              res.setHeader("Connection", "keep-alive");
              res.flushHeaders();
            }
          });
        },
      },
    },
  },
});
