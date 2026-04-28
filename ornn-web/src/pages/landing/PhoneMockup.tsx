import { forwardRef, useEffect, useState } from "react";

/**
 * iPhone-shaped device frame with a stack of three build layers that
 * animate in during the hero scroll-scrub.
 *
 * HeroStage owns the layer opacities and the "settled" / dimming state;
 * this component just exposes hooks (refs, data-target attrs) for it.
 */
type Props = {
  phoneRef: React.RefObject<HTMLDivElement | null>;
  layerBlankRef: React.RefObject<HTMLDivElement | null>;
  layerWireRef: React.RefObject<HTMLDivElement | null>;
  layerStyledRef: React.RefObject<HTMLDivElement | null>;
};

export const PhoneMockup = forwardRef<HTMLDivElement, Props>(function PhoneMockup(
  { phoneRef, layerBlankRef, layerWireRef, layerStyledRef },
  outerRef,
) {
  const clock = useLiveClock();
  return (
    <div
      ref={outerRef}
      className="relative flex h-full w-full items-center justify-center"
    >
      <div
        ref={phoneRef}
        className="group/phone relative z-10 w-[min(290px,100%)] aspect-[9/19] rounded-[44px] bg-obsidian px-[10px] py-[11px] shadow-[0_0_0_1.5px_#2a2620,inset_0_0_0_1px_rgb(255_255_255/0.04),inset_0_0_0_2px_rgb(0_0_0/0.9),0_50px_140px_-30px_rgb(0_0_0/0.92),0_0_100px_-20px_rgb(255_106_26/0.22)] [transform:perspective(1800px)_rotateY(-5deg)_rotateX(2deg)] [transform-origin:50%_50%] [transition:transform_0.6s_cubic-bezier(.2,.8,.3,1),filter_0.6s_ease] data-[settled=true]:[transform:perspective(1800px)_rotateY(0)_rotateX(0)] data-[dimmed=true]:brightness-[0.55] data-[dimmed=true]:saturate-[0.85] before:pointer-events-none before:absolute before:inset-0 before:z-[2] before:rounded-[44px] before:bg-[linear-gradient(135deg,rgb(255_255_255/0.06),rgb(255_255_255/0)_30%,rgb(255_255_255/0)_70%,rgb(255_255_255/0.04))]"
      >
        {/* Side buttons on bezel edges */}
        <span className="absolute -left-[3px] top-[92px] z-[3] h-6 w-[3px] rounded-l-[2px] bg-[#1a1713] shadow-[inset_0_1px_0_rgb(255_255_255/0.05),inset_0_-1px_0_rgb(0_0_0/0.6)]" />
        <span className="absolute -left-[3px] top-[132px] z-[3] h-[46px] w-[3px] rounded-l-[2px] bg-[#1a1713] shadow-[inset_0_1px_0_rgb(255_255_255/0.05),inset_0_-1px_0_rgb(0_0_0/0.6)]" />
        <span className="absolute -left-[3px] top-[190px] z-[3] h-[46px] w-[3px] rounded-l-[2px] bg-[#1a1713] shadow-[inset_0_1px_0_rgb(255_255_255/0.05),inset_0_-1px_0_rgb(0_0_0/0.6)]" />
        <span className="absolute -right-[3px] top-[150px] z-[3] h-[68px] w-[3px] rounded-r-[2px] bg-[#1a1713] shadow-[inset_0_1px_0_rgb(255_255_255/0.05),inset_0_-1px_0_rgb(0_0_0/0.6)]" />

        <div className="relative h-full w-full overflow-hidden rounded-[34px] bg-obsidian shadow-[inset_0_0_0_1px_rgb(255_255_255/0.02)]">
          {/* Notch */}
          <span className="absolute left-1/2 top-2.5 z-[4] h-[26px] w-[88px] -translate-x-1/2 rounded-[16px] bg-black shadow-[0_0_0_0.5px_#1a1713] after:absolute after:right-3 after:top-1/2 after:h-1.5 after:w-1.5 after:-translate-y-1/2 after:rounded-full after:content-[''] after:bg-[radial-gradient(circle_at_30%_30%,#3a5060,#0b1520)]" />

          {/* Status bar */}
          <div className="flex h-7 items-center justify-between px-[18px] pl-[22px] font-mono text-[10px] tracking-[0.08em] text-parchment">
            <span>{clock}</span>
            <span className="flex items-center gap-1.5 opacity-70">
              <span className="mr-px inline-block h-1 w-[3px] bg-parchment" />
              <span className="mr-px inline-block h-1.5 w-[3px] bg-parchment" />
              <span className="mr-px inline-block h-2 w-[3px] bg-parchment" />
              <span className="mr-px inline-block h-2.5 w-[3px] bg-parchment" />
            </span>
          </div>

          {/* Build layers — HeroStage sets opacity inline each frame */}
          <div className="absolute inset-x-0 bottom-0 top-9 overflow-hidden">
            <div
              ref={layerBlankRef}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ash"
            >
              <span>empty</span>
              <span className="inline-block h-3 w-1.5 bg-ember animate-blink" />
            </div>

            <div
              ref={layerWireRef}
              className="absolute inset-0 flex-col gap-3 p-4"
              style={{ opacity: 0, display: "flex" }}
            >
              <div className="flex items-center gap-2">
                <WireBox solid className="h-[18px] w-[18px] rounded-full" />
                <WireBox className="h-2.5 w-[54px]" />
                <WireBox className="ml-auto h-[14px] w-[14px] rounded-full" />
              </div>
              <div className="mt-2 flex flex-col gap-2">
                <WireBox className="h-2 w-[35%]" />
                <WireBox className="h-[22px] w-[90%]" />
                <WireBox className="h-[22px] w-[72%]" />
                <WireBox className="mt-1 h-2.5 w-[85%]" />
                <WireBox className="h-2.5 w-[78%]" />
              </div>
              <div className="relative mt-1.5 aspect-[16/10] w-full rounded-[3px] border border-dashed border-[rgb(201_191_173/0.28)] after:absolute after:inset-0 after:flex after:items-center after:justify-center after:text-base after:text-ash after:content-['◲']" />
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <WireBox className="h-11" />
                <WireBox className="h-11" />
              </div>
              <div className="mt-1.5 flex gap-2">
                <WireBox className="h-[30px] flex-1 border-[rgb(255_106_26/0.5)]" solidStrong />
                <WireBox className="h-[30px] flex-1" />
              </div>
            </div>

            <div
              ref={layerStyledRef}
              className="group/styled absolute inset-0 p-0"
              style={{ opacity: 0 }}
            >
              <div className="flex h-full flex-col gap-2.5 px-3.5 pb-4 pt-3.5">
                <Reveal index={1}>
                  <div data-target="nav" className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 font-display text-[14px] font-normal tracking-[-0.015em] text-parchment">
                      <span className="h-1.5 w-1.5 rounded-full bg-ember shadow-[0_0_6px_var(--color-ember)]" />
                      ornn
                    </div>
                    <div className="ml-auto flex gap-[3px]">
                      <span className="h-[3px] w-[3px] rounded-full bg-parchment" />
                      <span className="h-[3px] w-[3px] rounded-full bg-parchment" />
                      <span className="h-[3px] w-[3px] rounded-full bg-parchment" />
                    </div>
                  </div>
                </Reveal>
                <Reveal index={2}>
                  <div data-target="type" className="mt-1 flex flex-col gap-1.5">
                    <div className="font-mono text-[8px] uppercase tracking-[0.24em] text-ember">
                      № 001 · Registry
                    </div>
                    <div className="font-display text-[22px] font-light leading-none tracking-[-0.02em] text-parchment">
                      The registry for
                      <br />
                      <em className="italic font-normal text-ember">AI agent skills.</em>
                    </div>
                    <div className="font-text text-[10px] leading-[1.45] text-bone">
                      One command. Every runtime. Skills that compose into anything.
                    </div>
                  </div>
                </Reveal>
                <Reveal index={3}>
                  <div
                    data-target="media"
                    className="relative mt-1 aspect-[16/10] overflow-hidden rounded-[4px] [background-image:var(--gradient-styled-media)]"
                  >
                    <span className="absolute left-1/2 top-1/2 aspect-square w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgb(232_179_65/0.45)] animate-[spin_14s_linear_infinite]" />
                    <span className="absolute left-1/2 top-1/2 aspect-square w-[54%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgb(255_106_26/0.35)] animate-[spin_9s_linear_infinite_reverse]" />
                    <span className="absolute left-1/2 top-1/2 aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_50%_50%,rgb(255_180_72/0.95)_0%,rgb(255_106_26/0.55)_45%,transparent_72%)]" />
                  </div>
                </Reveal>
                <Reveal index={4}>
                  <div data-target="cards" className="grid grid-cols-2 gap-1.5">
                    <MiniCard tag="Featured" name="nyx-lark" meta="v 2.1" />
                    <MiniCard tag="Featured" name="ornn-build" meta="v 0.9" />
                  </div>
                </Reveal>
                <Reveal index={5}>
                  <div data-target="cta" className="mt-auto flex gap-1.5">
                    <span className="flex-1 rounded-[2px] bg-ember py-[9px] text-center font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-obsidian">
                      Browse →
                    </span>
                    <span className="flex-1 rounded-[2px] border border-[color:var(--color-border-strong)] py-[9px] text-center font-mono text-[9px] uppercase tracking-[0.12em] text-parchment">
                      Publish
                    </span>
                  </div>
                </Reveal>
              </div>
            </div>
          </div>

          {/* Home indicator */}
          <span className="pointer-events-none absolute bottom-1.5 left-1/2 z-[5] h-1 w-[90px] -translate-x-1/2 rounded-[2px] bg-[rgb(255_255_255/0.35)]" />
        </div>
      </div>
    </div>
  );
});

function WireBox({
  className = "",
  solid = false,
  solidStrong = false,
}: {
  className?: string;
  solid?: boolean;
  solidStrong?: boolean;
}) {
  const borderCls = solidStrong
    ? "border border-solid"
    : solid
      ? "border border-solid border-[color:var(--color-border-subtle)]"
      : "border border-dashed border-[rgb(201_191_173/0.28)]";
  return <div className={`rounded-[3px] ${borderCls} ${className}`} />;
}

function Reveal({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  // The styled layer gets data-on="true" when HeroStage's progress crosses
  // the reveal threshold; siblings stagger via per-child transition-delay.
  return (
    <div
      className="translate-y-1 opacity-0 transition-[opacity,transform] duration-500 ease-out group-data-[on=true]/styled:translate-y-0 group-data-[on=true]/styled:opacity-100"
      style={{ transitionDelay: `${0.02 + (index - 1) * 0.08}s` }}
    >
      {children}
    </div>
  );
}

function MiniCard({
  tag,
  name,
  meta,
}: {
  tag: string;
  name: string;
  meta: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[3px] border border-[color:var(--color-border-subtle)] [background-color:var(--surface-styled-card)] px-2 py-[7px]">
      <span className="font-mono text-[7px] uppercase tracking-[0.14em] text-ember">
        ⟶ {tag}
      </span>
      <span className="font-display text-[11px] tracking-[-0.01em] text-parchment">
        {name}
      </span>
      <span className="font-mono text-[7px] text-ash">{meta}</span>
    </div>
  );
}

function useLiveClock() {
  const [t, setT] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setT(formatClock(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return t;
}

function formatClock(d: Date) {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
