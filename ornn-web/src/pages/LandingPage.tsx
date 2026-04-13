/**
 * Landing Page.
 * Full-viewport home with dynamically floating skill names and centered tagline.
 * No scroll. Rendered inside RootLayout.
 * @module pages/LandingPage
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/** Decorative skill names that float in the background */
const SKILL_NAMES = [
  "web-scraper", "image-gen", "pdf-parser", "code-review",
  "text-summarizer", "data-pipeline", "api-tester", "log-analyzer",
  "markdown-converter", "json-validator", "csv-exporter", "email-drafter",
  "sql-generator", "chart-builder", "file-organizer", "token-counter",
  "prompt-optimizer", "schema-validator", "url-shortener", "html-cleaner",
  "sentiment-analyzer", "translation-tool", "regex-builder", "cron-scheduler",
  "env-checker", "docker-helper", "git-diff-reviewer", "dependency-auditor",
  "openapi-generator", "webhook-tester", "rate-limiter", "cache-warmer",
  "screenshot-tool", "rss-reader", "sitemap-gen", "dns-lookup",
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  name: string;
  size: number;
  opacity: number;
}

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function FloatingBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);
  const themeRef = useRef<string>("dark");

  const initialParticles = useMemo(() => {
    return SKILL_NAMES.map((name, i) => {
      const r = (n: number) => seededRandom(i * 100 + n);
      return {
        name,
        x: r(1) * 100,
        y: r(2) * 100,
        vx: (r(3) - 0.5) * 0.8 + (r(3) > 0.5 ? 0.15 : -0.15),
        vy: (r(4) - 0.5) * 0.5 + (r(4) > 0.5 ? 0.1 : -0.1),
        size: r(5) * 4 + 11,
        opacity: r(6) * 0.12 + 0.05,
      } satisfies Particle;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    particlesRef.current = initialParticles.map((p) => ({ ...p }));

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    // Watch theme
    const observer = new MutationObserver(() => {
      themeRef.current = document.documentElement.getAttribute("data-theme") ?? "dark";
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    themeRef.current = document.documentElement.getAttribute("data-theme") ?? "dark";

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const isLight = themeRef.current === "light";

      for (const p of particlesRef.current) {
        // Update position (percentages)
        p.x += p.vx * 0.06;
        p.y += p.vy * 0.06;

        // Wrap around edges
        if (p.x > 105) p.x = -5;
        if (p.x < -5) p.x = 105;
        if (p.y > 105) p.y = -5;
        if (p.y < -5) p.y = 105;

        const px = (p.x / 100) * w;
        const py = (p.y / 100) * h;

        ctx.font = `${p.size}px "JetBrains Mono", monospace`;
        ctx.fillStyle = isLight
          ? `rgba(0, 0, 0, ${p.opacity})`
          : `rgba(255, 255, 255, ${p.opacity})`;
        ctx.fillText(p.name, px, py);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, [initialParticles]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    />
  );
}

function AnnouncementBanner() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "zh" ? "zh" : "en";
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/web/docs/releases?lang=${lang}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data?.length > 0) {
          setVersion(json.data[0].version);
          setTitle(json.data[0].title);
        }
      })
      .catch(() => {});
  }, [lang]);

  if (!version) return null;

  const text = `${t("landing.bannerNew")}  Ornn v${version} — ${title}`;

  return (
    <div className="shrink-0 relative z-10 overflow-hidden border-b border-neon-cyan/15 bg-neon-cyan/5">
      <div className="inline-flex whitespace-nowrap" style={{ animation: "marquee 30s linear infinite" }}>
        {[0, 1].map((g) => (
          <span key={g} className="inline-flex items-center py-1.5 shrink-0 min-w-[100vw] justify-around">
            <span className="font-mono text-xs text-neon-cyan/80">{text}</span>
            <span className="font-mono text-xs text-neon-cyan/80">{text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="h-full -mx-6 sm:-mx-10 relative overflow-hidden flex flex-col">
      {/* Announcement banner */}
      <AnnouncementBanner />

      {/* Floating skill names background */}
      <FloatingBackground />

      {/* Center content */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div className="text-center max-w-3xl px-6">
          <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold tracking-wide leading-tight mb-6">
            <span className="text-text-primary">{t("landing.heroTitle1")} </span>
            <span className="text-neon-cyan">{t("landing.heroTitle2")}</span>
          </h1>
          <p className="font-heading text-xl sm:text-2xl font-bold text-neon-cyan tracking-widest uppercase mb-6 drop-shadow-[0_0_10px_rgba(255,107,0,0.6)]">
            Skill-as-a-Service
          </p>
          <p className="font-body text-lg sm:text-xl text-text-muted max-w-2xl mx-auto leading-relaxed mb-10">
            {t("landing.heroDesc")}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/registry"
              className="inline-flex items-center gap-2 rounded-lg bg-neon-cyan/15 border border-neon-cyan px-6 py-3 font-body text-base font-semibold text-neon-cyan transition-all duration-200 hover:bg-neon-cyan/25 hover:shadow-[0_0_20px_rgba(255,107,0,0.3)]"
            >
              {t("landing.exploreBtn")}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 rounded-lg border border-text-muted/30 bg-bg-surface/50 px-6 py-3 font-body text-base font-semibold text-text-primary transition-all duration-200 hover:border-text-muted/60 hover:bg-bg-elevated"
            >
              {t("landing.viewDocs")}
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 text-center py-4 relative z-10">
        <p className="font-body text-xs text-text-muted/50">
          &copy; 2026 Ornn. All rights reserved.
        </p>
      </div>
    </div>
  );
}
