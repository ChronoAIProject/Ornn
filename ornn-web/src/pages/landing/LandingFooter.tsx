import { Link } from "react-router-dom";

export function LandingFooter() {
  return (
    <footer className="border-t border-[color:var(--color-border-subtle)] bg-graphite px-6 pb-8 pt-14 sm:px-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid gap-10 sm:grid-cols-2 lg:[grid-template-columns:2fr_1fr_1fr]">
          <div>
            <svg
              className="mb-4 block h-[22px] w-auto text-parchment"
              viewBox="0 0 230 64"
              fill="none"
              aria-label="ornn"
            >
              <path
                fill="var(--color-ember)"
                fillRule="evenodd"
                d="M63.39,38.24 L59.46,37.46 A28,28 0 0,1 55.28,47.56 L58.61,49.78 A32,32 0 0,1 49.78,58.61 L47.56,55.28 A28,28 0 0,1 37.46,59.46 L38.24,63.39 A32,32 0 0,1 25.76,63.39 L26.54,59.46 A28,28 0 0,1 16.44,55.28 L14.22,58.61 A32,32 0 0,1 5.39,49.78 L8.72,47.56 A28,28 0 0,1 4.54,37.46 L0.61,38.24 A32,32 0 0,1 0.61,25.76 L4.54,26.54 A28,28 0 0,1 8.72,16.44 L5.39,14.22 A32,32 0 0,1 14.22,5.39 L16.44,8.72 A28,28 0 0,1 26.54,4.54 L25.76,0.61 A32,32 0 0,1 38.24,0.61 L37.46,4.54 A28,28 0 0,1 47.56,8.72 L49.78,5.39 A32,32 0 0,1 58.61,14.22 L55.28,16.44 A28,28 0 0,1 59.46,26.54 L63.39,25.76 A32,32 0 0,1 63.39,38.24 Z M46,32 A14,14 0 1,0 18,32 A14,14 0 1,0 46,32 Z"
              />
              <g fill="currentColor">
                <path d="M74,60 L74,12 L86,12 A24,24 0 0,1 110,36 L98,36 A12,12 0 0,0 86,24 L86,60 Z" />
                <path d="M122,60 L122,36 A24,24 0 0,1 170,36 L170,60 L158,60 L158,36 A12,12 0 0,0 134,36 L134,60 Z" />
                <path d="M182,60 L182,36 A24,24 0 0,1 230,36 L230,60 L218,60 L218,36 A12,12 0 0,0 194,36 L194,60 Z" />
              </g>
            </svg>
            <p className="max-w-[280px] font-ui text-[13px] leading-[1.55] text-meta">
              The registry for AI agent skills. From the Chrono AI workshop.
            </p>
          </div>
          {/* Mobile: Product + Developers side-by-side via inner 2-col grid.
              sm+: `display:contents` flattens the wrapper so the columns join
              the outer grid as direct siblings of the logo block. */}
          <div className="grid grid-cols-2 gap-10 sm:contents">
            <Column heading="Product">
              <FooterLink href="/registry">Browse</FooterLink>
              <FooterLink href="/login">Publish</FooterLink>
              <FooterLink href="/docs?section=cli">CLI</FooterLink>
              <FooterLink
                external
                href="https://github.com/ChronoAIProject/Ornn/releases"
              >
                Changelog
              </FooterLink>
            </Column>
            <Column heading="Developers">
              <FooterLink href="/docs">Docs</FooterLink>
              <FooterLink href="/docs?section=skill-format">
                Skill format
              </FooterLink>
              <FooterLink
                external
                href="https://github.com/ChronoAIProject/Ornn"
              >
                GitHub
              </FooterLink>
            </Column>
          </div>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-2 border-t border-[color:var(--color-border-subtle)] pt-5 font-mono text-[11px] text-meta sm:flex-row">
          <div>© 2026 Chrono AI</div>
          <div>ornn.chrono-ai.fun</div>
        </div>
      </div>
    </footer>
  );
}

function Column({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-meta">
        {heading}
      </h4>
      <ul className="m-0 list-none space-y-1.5 p-0">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  external = false,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls = "font-ui text-[13px] text-bone no-underline transition-colors duration-150 hover:text-ember";
  return (
    <li>
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
        >
          {children}
        </a>
      ) : (
        <Link to={href} className={cls}>
          {children}
        </Link>
      )}
    </li>
  );
}
