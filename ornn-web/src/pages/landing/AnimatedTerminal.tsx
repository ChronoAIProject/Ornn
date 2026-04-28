import { useEffect, useRef } from "react";

type Line = { t: number; html: string };

const LINES: Line[] = [
  { t: 500, html: '<span class="text-ember">$</span> <span class="text-parchment">ornn-search-and-run</span> <span class="text-molten">"extract text from PDFs"</span>' },
  { t: 300, html: '<span class="text-ash">  ↳ querying registry...</span>' },
  { t: 400, html: '<span class="text-ash">  ↳ matched 3 candidates</span>' },
  { t: 400, html: '<span class="text-[#7dc97d]">  ✓ pdf-extract</span>   <span class="text-ash">@chrono · v 2.0.1 · audited</span>' },
  { t: 300, html: '<span class="text-ash">  ↳ loading SKILL.md into Claude Code...</span>' },
  { t: 400, html: '<span class="text-[#7dc97d]">  ✓ ready</span>          <span class="text-ash">~/.claude/skills/pdf-extract/</span>' },
  { t: 400, html: "" },
  { t: 200, html: '<span class="text-bone">agent-ready in <span class="text-molten">1.2s</span></span>' },
  { t: 600, html: '<span class="text-ember">$</span> <span class="inline-block h-3.5 w-2 bg-ember align-middle animate-blink"></span>' },
];

/**
 * Looping terminal animation showing `ornn install pdf-extract` lighting up
 * four runtimes. Lines are staggered via setTimeout, then the body resets and
 * replays after a pause. Pauses when the user hides the tab.
 */
export function AnimatedTerminal() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const clearAll = () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };

    let cancelled = false;
    const run = () => {
      if (cancelled || !body) return;
      body.innerHTML = "";
      let delay = 0;
      LINES.forEach((ln) => {
        delay += ln.t;
        const id = window.setTimeout(() => {
          if (cancelled) return;
          const div = document.createElement("div");
          div.innerHTML = ln.html || "&nbsp;";
          body.appendChild(div);
        }, delay);
        timersRef.current.push(id);
      });
      const replay = window.setTimeout(run, delay + 3500);
      timersRef.current.push(replay);
    };

    const onVis = () => {
      if (document.hidden) {
        clearAll();
      } else if (timersRef.current.length === 0) {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    run();
    return () => {
      cancelled = true;
      clearAll();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-[4px] border border-[color:var(--color-border-strong)] [background-color:var(--surface-code)] font-mono text-[13px] shadow-[0_20px_60px_-20px_rgb(0_0_0/0.6),0_0_0_1px_rgb(255_106_26/0.08)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--color-border-subtle)] bg-graphite px-3.5 py-2.5">
        <span className="h-[9px] w-[9px] rounded-full bg-[#c94a4a]" />
        <span className="h-[9px] w-[9px] rounded-full bg-[#c9a64a]" />
        <span className="h-[9px] w-[9px] rounded-full bg-[#5a9b5a]" />
        <span className="ml-auto font-mono text-[11px] tracking-[0.12em] text-meta">
          ~/projects · ornn cli
        </span>
      </div>
      <div
        ref={bodyRef}
        className="min-h-[280px] px-5 py-5 leading-[1.7]"
        aria-live="polite"
      />
    </div>
  );
}
