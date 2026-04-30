import { Link } from "react-router-dom";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Variant = "primary" | "ghost";

/* Forge Workshop letterpress treatment — see DESIGN.md.
   Per-state shadows + press-down hover/active live in the .cta-letterpress
   utility (neon.css). Variants only set color / border / fill; movement and
   shadow are inherited. */
const base =
  "cta-letterpress inline-flex items-center gap-2.5 rounded-[2px] px-[22px] py-3 font-mono text-xs font-semibold uppercase tracking-[0.12em] border cursor-pointer select-none";

const variants: Record<Variant, string> = {
  primary:
    "border-[color:var(--color-accent-muted)] bg-ember text-obsidian",
  ghost:
    "cta-letterpress--ghost border-[color:var(--color-border-strong)] bg-transparent text-parchment hover:border-ember hover:text-ember",
};

type CommonProps = {
  variant?: Variant;
  children: ReactNode;
  className?: string;
};

type ButtonProps = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, "className" | "children">;

export function EmberButton({
  variant = "primary",
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

type LinkProps = CommonProps & {
  to?: string;
  href?: string;
} & Omit<ComponentPropsWithoutRef<"a">, "className" | "children" | "href">;

/**
 * Link-flavored ember CTA. Use `to` for in-app routes (React Router)
 * and `href` for hash anchors or external URLs.
 */
export function EmberLink({
  variant = "primary",
  children,
  className = "",
  to,
  href,
  ...rest
}: LinkProps) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} {...rest}>
      {children}
    </a>
  );
}
