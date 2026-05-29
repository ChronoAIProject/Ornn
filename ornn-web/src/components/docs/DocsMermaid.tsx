/**
 * Mermaid renderer + lightbox extracted from DocsPage (#453).
 *
 * Bundles four pieces that all coordinate around mermaid output:
 *   - MERMAID_DARK / MERMAID_LIGHT — per-theme variables
 *   - SandboxedSvg — `iframe sandbox=""` defence-in-depth wrapper (#440)
 *   - MermaidLightbox — fullscreen zoom + pan + reset
 *   - MermaidBlock — the actual `<MermaidBlock chart={...}/>` markdown component
 *
 * Mermaid is initialised once at import time with the user's current
 * theme; MermaidBlock re-initialises on theme change before each
 * render so the diagrams swap palettes alongside the rest of the UI.
 *
 * @module components/docs/DocsMermaid
 */

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { useThemeStore } from "@/stores/themeStore";

const MERMAID_DARK = {
  startOnLoad: false,
  theme: "dark" as const,
  themeVariables: {
    darkMode: true,
    primaryColor: "#FF6B00",
    primaryTextColor: "#e8e8e8",
    primaryBorderColor: "#FF6B00",
    lineColor: "#FF8C38",
    secondaryColor: "#1e1e1e",
    tertiaryColor: "#131313",
    background: "#0a0a0f",
    mainBkg: "#1e1e1e",
    nodeBorder: "#FF6B00",
    clusterBkg: "#131313",
    clusterBorder: "#FF6B0044",
    titleColor: "#FF6B00",
    edgeLabelBackground: "#0a0a0f",
    noteTextColor: "#e8e8e8",
    noteBkgColor: "#1e1e1e",
    noteBorderColor: "#FF6B0044",
    actorTextColor: "#e8e8e8",
    actorBkg: "#1e1e1e",
    actorBorder: "#FF6B00",
    signalColor: "#FF8C38",
    signalTextColor: "#e8e8e8",
    labelTextColor: "#e8e8e8",
    loopTextColor: "#e8e8e8",
  },
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
};

const MERMAID_LIGHT = {
  startOnLoad: false,
  theme: "base" as const,
  themeVariables: {
    darkMode: false,
    primaryColor: "#d45a00",
    primaryTextColor: "#2d2d2d",
    primaryBorderColor: "#d45a00",
    lineColor: "#c06000",
    secondaryColor: "#f3f3f5",
    tertiaryColor: "#ffffff",
    background: "#fafafa",
    mainBkg: "#fff5ee",
    nodeBorder: "#d45a00",
    clusterBkg: "#fdf6f0",
    clusterBorder: "#d45a0044",
    titleColor: "#b34a00",
    edgeLabelBackground: "#fafafa",
    noteTextColor: "#2d2d2d",
    noteBkgColor: "#fff5ee",
    noteBorderColor: "#d45a0044",
    actorTextColor: "#2d2d2d",
    actorBkg: "#fff5ee",
    actorBorder: "#d45a00",
    signalColor: "#c06000",
    signalTextColor: "#2d2d2d",
    labelTextColor: "#2d2d2d",
    loopTextColor: "#2d2d2d",
  },
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
};

function getMermaidConfig(theme: "dark" | "light") {
  return theme === "dark" ? MERMAID_DARK : MERMAID_LIGHT;
}

// Initial init with current theme.
mermaid.initialize(getMermaidConfig(useThemeStore.getState().theme));

/**
 * Render an SVG string inside a sandboxed iframe (#440).
 *
 * Mermaid is the only producer today, and the diagram source comes
 * from trusted in-repo markdown — so this is purely defence-in-depth.
 * If any future code path ever feeds user-controlled diagram source
 * (e.g. user-authored skill READMEs embedding ` ```mermaid `), the
 * iframe `sandbox=""` boundary prevents script execution, form
 * submission, navigation, and storage access without us having to
 * audit Mermaid's output for XSS first.
 *
 * Layout: the iframe fills its container; the parent owns the
 * transform/pan/zoom, so the existing lightbox interactions keep
 * working unchanged.
 */
function SandboxedSvg({ svg, className }: { svg: string; className?: string }) {
  // Strict sandbox: no scripts, no forms, no top navigation, no
  // popups, no same-origin. The iframe can render the SVG and that's
  // all.
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
  return (
    <iframe
      sandbox=""
      srcDoc={srcDoc}
      title="diagram"
      className={className}
      style={{ width: "100%", height: "100%", border: "none", background: "transparent" }}
    />
  );
}

function MermaidLightbox({ svg, onClose }: { svg: string; onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  // Zoom with scroll wheel
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((s) => Math.min(Math.max(0.2, s + delta), 5));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.target === viewportRef.current) { onClose(); return; }
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, originX: translate.x, originY: translate.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTranslate({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy });
  };

  const handlePointerUp = () => { dragRef.current.dragging = false; };

  const handleReset = () => { setScale(1); setTranslate({ x: 0, y: 0 }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <button type="button" onClick={() => setScale((s) => Math.min(s + 0.25, 5))} className="rounded bg-elevated px-3 py-1.5 font-mono text-sm text-strong hover:bg-accent/20 transition-colors cursor-pointer">+</button>
        <span className="rounded bg-elevated px-3 py-1.5 font-mono text-sm text-meta min-w-[4rem] text-center">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => setScale((s) => Math.max(s - 0.25, 0.2))} className="rounded bg-elevated px-3 py-1.5 font-mono text-sm text-strong hover:bg-accent/20 transition-colors cursor-pointer">−</button>
        <button type="button" onClick={handleReset} className="rounded bg-elevated px-3 py-1.5 font-mono text-sm text-strong hover:bg-accent/20 transition-colors cursor-pointer">Reset</button>
        <button type="button" onClick={onClose} className="rounded bg-elevated px-3 py-1.5 font-mono text-sm text-strong hover:bg-accent/20 transition-colors cursor-pointer">✕</button>
      </div>
      {/* Viewport */}
      <div
        ref={viewportRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          ref={contentRef}
          className="absolute left-1/2 top-1/2 mermaid-container [&_svg]:max-w-none"
          style={{
            transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "center center",
            // Fixed dimensions so the sandboxed iframe has something
            // concrete to fill — the parent's pan/zoom transform
            // still handles all the interaction.
            width: "min(90vw, 80vh)",
            height: "min(80vh, 90vw)",
          }}
        >
          <SandboxedSvg svg={svg} />
        </div>
      </div>
    </div>
  );
}

let mermaidCounter = 0;

export function MermaidBlock({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++mermaidCounter}`;

    // Re-initialize mermaid with current theme before rendering
    mermaid.initialize(getMermaidConfig(theme));

    mermaid.render(id, chart).then(({ svg: rendered }) => {
      if (!cancelled) setSvg(rendered);
    }).catch((err) => {
      if (!cancelled) setSvg(`<pre style="color:#ff003c">Mermaid error: ${err.message}</pre>`);
    });

    return () => { cancelled = true; };
  }, [chart, theme]);

  return (
    <>
      <div
        ref={containerRef}
        className="mermaid-container group relative my-4 overflow-x-auto rounded border border-accent/10 bg-page p-4 cursor-pointer"
        onClick={() => setLightboxOpen(true)}
        style={{ minHeight: svg ? "240px" : undefined }}
      >
        {svg ? <SandboxedSvg svg={svg} /> : null}
      </div>
      {lightboxOpen && <MermaidLightbox svg={svg} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}
