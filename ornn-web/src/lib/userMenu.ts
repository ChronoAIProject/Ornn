/**
 * Single source of truth for the signed-in avatar dropdown content.
 *
 * Items live here — typed, i18n-resolved, admin-gated — and the unified
 * `Navbar` renders them with its dropdown wrappers (`DropdownInternal` /
 * `DropdownExternal` / inline logout button). Adding or renaming an
 * item touches one file. Historically this dropdown shipped on two
 * surfaces (`Navbar` + `LandingNav`) that drifted apart (see #363, #361);
 * the two surfaces have since been folded into a single `Navbar` —
 * keeping the item list here is now belt-and-braces but harmless.
 *
 * `getNyxIdUrl()` is also exported from here because the navs were
 * carrying verbatim copies before consolidation.
 *
 * @module lib/userMenu
 */

import { useTranslation } from "react-i18next";
import { config } from "@/config";
import { isAdmin } from "@/stores/authStore";
import type { AuthUser } from "@/types/auth";

/** Derive the NyxID portal origin from the runtime authorize URL. */
export function getNyxIdUrl(): string {
  try {
    const authorizeUrl = config.nyxidOauthAuthorizeUrl;
    if (authorizeUrl) {
      return new URL(authorizeUrl).origin;
    }
  } catch {
    /* ignore — fall through to the legacy default below */
  }
  return "https://nyx.chrono-ai.fun"; // allow-hardcode legacy fallback; runtime config supplies the real value
}

export type UserMenuItemKind = "external" | "internal" | "logout";

export interface UserMenuItem {
  /** Stable React key. */
  readonly key: string;
  readonly kind: UserMenuItemKind;
  /** Already-localized label. */
  readonly label: string;
  /** Set when `kind === "external"`. Opens via target=_blank. */
  readonly href?: string;
  /** Set when `kind === "internal"`. In-app router path. */
  readonly to?: string;
}

export type UserMenuGroupId = "main" | "admin" | "logout";

export interface UserMenuGroup {
  readonly id: UserMenuGroupId;
  readonly items: readonly UserMenuItem[];
}

/**
 * Returns the dropdown content for the currently signed-in user, or
 * an empty array when anonymous. Groups carry an `id` so the consumer
 * can draw separators between them (the first group has no top border;
 * each subsequent group is rendered with a hairline divider above).
 *
 * The hook is intentionally tiny — pure derivation on top of
 * `useTranslation` and the passed-in user. No side effects, no
 * subscriptions; safe to call in any nav component.
 */
export function useUserMenuGroups(user: AuthUser | null): UserMenuGroup[] {
  const { t } = useTranslation();
  if (!user) return [];
  const nyxid = getNyxIdUrl();

  const main: UserMenuGroup = {
    id: "main",
    items: [
      {
        key: "profile",
        kind: "external",
        href: `${nyxid}/settings`,
        label: t("nav.myProfile"),
      },
      {
        key: "services",
        kind: "external",
        href: `${nyxid}/keys`,
        label: t("nav.myServices"),
      },
      {
        key: "orgs",
        kind: "external",
        href: `${nyxid}/orgs`,
        label: t("nav.myOrgs"),
      },
      {
        key: "redeem",
        kind: "internal",
        to: "/settings",
        label: t("nav.redeemCode"),
      },
      {
        key: "nyxid",
        kind: "external",
        href: nyxid,
        label: t("nav.goToNyxId"),
      },
    ],
  };

  const groups: UserMenuGroup[] = [main];

  if (isAdmin(user)) {
    groups.push({
      id: "admin",
      items: [
        {
          key: "admin-panel",
          kind: "internal",
          to: "/admin",
          label: t("nav.adminPanel"),
        },
        {
          key: "admin-services",
          kind: "external",
          href: `${nyxid}/services`,
          label: t("nav.adminServices"),
        },
      ],
    });
  }

  groups.push({
    id: "logout",
    items: [
      {
        key: "logout",
        kind: "logout",
        label: t("nav.signOut"),
      },
    ],
  });

  return groups;
}
