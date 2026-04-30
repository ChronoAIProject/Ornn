import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/brand/Logo";

export function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-[color:var(--color-border-subtle)] bg-graphite px-6 pb-8 pt-14 sm:px-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid gap-10 sm:grid-cols-2 lg:[grid-template-columns:2fr_1fr_1fr]">
          <div>
            <Logo className="mb-4 block h-[22px] w-auto text-parchment" />
            <p className="max-w-[280px] font-ui text-[13px] leading-[1.55] text-meta">
              {t("landing.footer.tagline")}
            </p>
          </div>
          {/* Mobile: Product + Developers side-by-side via inner 2-col grid.
              sm+: `display:contents` flattens the wrapper so the columns join
              the outer grid as direct siblings of the logo block. */}
          <div className="grid grid-cols-2 gap-10 sm:contents">
            <Column heading={t("landing.footer.productHeading")}>
              <FooterLink href="/registry">{t("landing.footer.productBrowse")}</FooterLink>
              <FooterLink href="/login">{t("landing.footer.productPublish")}</FooterLink>
              <FooterLink href="/docs?section=cli">{t("landing.footer.productCli")}</FooterLink>
              <FooterLink
                external
                href="https://github.com/ChronoAIProject/Ornn/releases"
              >
                {t("landing.footer.productChangelog")}
              </FooterLink>
            </Column>
            <Column heading={t("landing.footer.developersHeading")}>
              <FooterLink href="/docs">{t("landing.footer.developersDocs")}</FooterLink>
              <FooterLink href="/docs?section=skill-format">
                {t("landing.footer.developersSkillFormat")}
              </FooterLink>
              <FooterLink
                external
                href="https://github.com/ChronoAIProject/Ornn"
              >
                {t("landing.footer.developersGitHub")}
              </FooterLink>
            </Column>
          </div>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-2 border-t border-[color:var(--color-border-subtle)] pt-5 font-mono text-[11px] text-meta sm:flex-row">
          <div>{t("landing.footer.copyright")}</div>
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
