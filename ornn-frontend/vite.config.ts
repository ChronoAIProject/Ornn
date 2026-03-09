import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5847,
    proxy: {
      "/api/auth": {
        target: "http://localhost:3801",
        changeOrigin: true,
      },
      "/api/users": {
        target: "http://localhost:3801",
        changeOrigin: true,
      },
      "/api/admin": {
        target: "http://localhost:3801",
        changeOrigin: true,
      },
      "/api/skills": {
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
      "/api/skill-search": {
        target: "http://localhost:3802",
        changeOrigin: true,
      },
      "/api/skill-format": {
        target: "http://localhost:3802",
        changeOrigin: true,
      },
      "/api/playground": {
        target: "http://localhost:3803",
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
