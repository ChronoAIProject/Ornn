/**
 * QuotaManagementPage — admin lever for the v1 monthly quota model.
 *
 * Layout:
 *   - CalendarPeriodBanner (UTC month start/end)
 *   - Surface tabs (PLAYGROUND / SKILL GENERATION) preserved in URL `?surface=`
 *   - Search filter + paginated QuotaTable
 *   - Click row → QuotaUserDetailDrawer (current-month by model + lifetime chart)
 *   - Per-row "Grant +N" → GrantQuotaModal (current month only)
 *
 * The page does not show daily counters — those are gone in v1. Admins
 * never appear in this list (server filters them) because admins bypass
 * the quota.
 *
 * URL contract: `?userId=<id>&surface=<surface>` deep-links straight to
 * the grant modal so the per-row link from /admin/users works.
 *
 * @module pages/admin/QuotaManagementPage
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { useDebounce } from "@/hooks/useDebounce";
import { useAdminQuotaUsers } from "@/hooks/useQuota";
import { CalendarPeriodBanner } from "@/components/admin/quota/CalendarPeriodBanner";
import { QuotaTable } from "@/components/admin/quota/QuotaTable";
import { QuotaUserDetailDrawer } from "@/components/admin/quota/QuotaUserDetailDrawer";
import { GrantQuotaModal } from "@/components/admin/quota/GrantQuotaModal";
import type { AdminQuotaRow, Surface } from "@/services/quotaApi";
import { translateError } from "@/utils/translateError";

const PAGE_SIZE = 20;

function isSurface(s: string | null): s is Surface {
  return s === "playground" || s === "skillGen";
}

export function QuotaManagementPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const TABS: Array<{ id: Surface; label: string }> = [
    { id: "playground", label: t("adminPages.quota.tabs.playground") },
    { id: "skillGen", label: t("adminPages.quota.tabs.skillGen") },
  ];

  const initialSurface = isSurface(params.get("surface")) ? (params.get("surface") as Surface) : "playground";
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);

  const [drawerRow, setDrawerRow] = useState<AdminQuotaRow | null>(null);
  const [grantRow, setGrantRow] = useState<AdminQuotaRow | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);

  const usersQuery = useAdminQuotaUsers({
    surface,
    page,
    pageSize: PAGE_SIZE,
    q: debounced || undefined,
  });

  // Deep-link from /admin/users "Grant quota" action: open the modal as
  // soon as the matching row arrives, then strip the query param so a
  // refresh doesn't re-trigger.
  //
  // The modal-open is state, so it runs in the "adjust state during
  // render" guard (no setState-in-effect cascade, #888). The param strip
  // is a router navigation — a genuine external-system side effect — so
  // it stays in an effect, but that effect never calls setState, so it
  // doesn't trip the rule.
  const deepLinkUserId = params.get("userId");
  const deepLinkRow =
    deepLinkUserId && usersQuery.data
      ? usersQuery.data.items.find((r) => r.userId === deepLinkUserId) ?? null
      : null;
  const [consumedDeepLink, setConsumedDeepLink] = useState<string | null>(null);
  if (deepLinkRow && consumedDeepLink !== deepLinkUserId) {
    setConsumedDeepLink(deepLinkUserId);
    setGrantRow(deepLinkRow);
    setGrantOpen(true);
  }

  useEffect(() => {
    if (!deepLinkUserId || consumedDeepLink !== deepLinkUserId) return;
    const next = new URLSearchParams(params);
    next.delete("userId");
    setParams(next, { replace: true });
  }, [deepLinkUserId, consumedDeepLink, params, setParams]);

  const items = usersQuery.data?.items ?? [];
  const banner = usersQuery.data?.banner;
  const totalPages = usersQuery.data?.totalPages ?? 1;

  const onTabChange = (next: Surface) => {
    setSurface(next);
    setPage(1);
    const np = new URLSearchParams(params);
    np.set("surface", next);
    setParams(np, { replace: true });
  };

  const grantUser = useMemo(
    () =>
      grantRow
        ? {
            userId: grantRow.userId,
            email: grantRow.email,
            displayName: grantRow.displayName,
          }
        : null,
    [grantRow],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
            {t("adminPages.quota.title")}
          </h1>
          <p className="mt-1 font-text text-meta">
            {t("adminPages.quota.subtitle")}
          </p>
        </div>
        {banner && (
          <CalendarPeriodBanner
            monthStart={banner.monthStart}
            monthEnd={banner.monthEnd}
          />
        )}
      </header>

      <nav
        role="tablist"
        aria-label={t("adminPages.quota.aria.surface")}
        className="flex border-b border-subtle"
      >
        {TABS.map((t) => {
          const active = t.id === surface;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(t.id)}
              className={`-mb-px border-b-2 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-meta hover:text-strong"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder={t("adminPages.quota.placeholder.filter")}
          aria-label={t("adminPages.quota.aria.filter")}
          className="w-full max-w-sm rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-mono text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:bg-card focus:outline-none"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <QuotaTable
            rows={items}
            surface={surface}
            isLoading={usersQuery.isLoading}
            errorMessage={
              usersQuery.error
                ? translateError(usersQuery.error, t("adminPages.quota.loadFailed"))
                : null
            }
            onRowClick={(row) => setDrawerRow(row)}
            onGrantClick={(row) => {
              setGrantRow(row);
              setGrantOpen(true);
            }}
          />
        </Card>
      </motion.div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <QuotaUserDetailDrawer
        isOpen={drawerRow !== null}
        onClose={() => setDrawerRow(null)}
        surface={surface}
        row={drawerRow}
        onGrantClick={(row) => {
          setGrantRow(row);
          setGrantOpen(true);
        }}
      />

      <GrantQuotaModal
        isOpen={grantOpen}
        onClose={() => setGrantOpen(false)}
        surface={surface}
        user={grantUser}
      />
    </div>
  );
}
