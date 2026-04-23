import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
