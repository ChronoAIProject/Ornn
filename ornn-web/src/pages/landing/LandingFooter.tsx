import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/brand/Logo";

export function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-[color:var(--color-border-subtle)] bg-graphite px-6 pb-8 pt-14 sm:px-8">
      <div className="mx-auto max-w-[1280px]">
        {/* Logo + tagline only — the Product / Developers columns were
            dropped (#324 follow-up) because every link there is already
            reachable from the top nav (Registry / Build / Docs / GitHub
            icon). Footer keeps the brand mark + a one-line tagline. */}
        <div>
          <Logo className="mb-4 block h-[22px] w-auto text-parchment" />
          <p className="max-w-[420px] font-ui text-[13px] leading-[1.55] text-meta">
            {t("landing.footer.tagline")}
          </p>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-3 border-t border-[color:var(--color-border-subtle)] pt-5 font-mono text-[11px] text-meta sm:flex-row sm:items-center">
          <div>{t("landing.footer.copyright")}</div>
          <nav
            aria-label={t("aria.legal")}
            className="flex flex-wrap gap-x-5 gap-y-1"
          >
            <Link
              to="/legal/privacy"
              className="text-meta no-underline transition-colors hover:text-ember"
            >
              {t("landing.footer.legalPrivacy", "Privacy")}
            </Link>
            <Link
              to="/legal/terms"
              className="text-meta no-underline transition-colors hover:text-ember"
            >
              {t("landing.footer.legalTerms", "Terms")}
            </Link>
            <Link
              to="/legal/acceptable-use"
              className="text-meta no-underline transition-colors hover:text-ember"
            >
              {t("landing.footer.legalAup", "Acceptable Use")}
            </Link>
          </nav>
          <div>ornn.chrono-ai.fun</div>{/* allow-hardcode brand string in marketing footer */}
        </div>
      </div>
    </footer>
  );
}
