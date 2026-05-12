/**
 * RedemptionCodesPage — admin lever for minted single-use redemption
 * codes (issue #306).
 *
 * Layout:
 *   - Page header + "Mint code" CTA
 *   - Status filter chips (all / active / redeemed / invalidated)
 *   - Search input (debounced) — code prefix or note substring
 *   - Paginated RedemptionCodesTable with row click → detail drawer
 *   - Per-row Invalidate button on active rows
 *
 * @module pages/admin/RedemptionCodesPage
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { useDebounce } from "@/hooks/useDebounce";
import { useToastStore } from "@/stores/toastStore";
import {
  useAdminRedemptionCodes,
  useInvalidateCode,
} from "@/hooks/useRedemptionCodes";
import { MintRedemptionCodeModal } from "@/components/admin/redemption-codes/MintRedemptionCodeModal";
import { RedemptionCodeDetailDrawer } from "@/components/admin/redemption-codes/RedemptionCodeDetailDrawer";
import { RedemptionCodesTable } from "@/components/admin/redemption-codes/RedemptionCodesTable";
import { translateError } from "@/utils/translateError";
import type {
  RedemptionCode,
  RedemptionCodeStatus,
} from "@/services/redemptionCodesApi";

const PAGE_SIZE = 20;

export function RedemptionCodesPage() {
  const { t } = useTranslation();
  const STATUS_TABS: Array<{ id: RedemptionCodeStatus | "all"; label: string }> = [
    { id: "all", label: t("adminPages.redemption.tabs.all") },
    { id: "active", label: t("adminPages.redemption.tabs.active") },
    { id: "redeemed", label: t("adminPages.redemption.tabs.redeemed") },
    { id: "invalidated", label: t("adminPages.redemption.tabs.invalidated") },
  ];

  const [statusFilter, setStatusFilter] = useState<
    RedemptionCodeStatus | "all"
  >("all");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);

  const [mintOpen, setMintOpen] = useState(false);
  const [drawerCode, setDrawerCode] = useState<RedemptionCode | null>(null);
  const [pendingInvalidate, setPendingInvalidate] = useState<RedemptionCode | null>(
    null,
  );
  const [pendingInvalidateId, setPendingInvalidateId] = useState<string | null>(
    null,
  );

  const addToast = useToastStore((s) => s.addToast);
  const invalidateCode = useInvalidateCode();

  const codesQuery = useAdminRedemptionCodes({
    status: statusFilter === "all" ? undefined : statusFilter,
    search: debounced || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const items = codesQuery.data?.items ?? [];
  const totalPages = codesQuery.data?.totalPages ?? 1;

  const onTabChange = (next: RedemptionCodeStatus | "all") => {
    setStatusFilter(next);
    setPage(1);
  };

  const onInvalidate = (code: RedemptionCode) => {
    setPendingInvalidate(code);
  };

  const onConfirmInvalidate = async () => {
    const code = pendingInvalidate;
    if (!code) return;
    setPendingInvalidateId(code.id);
    try {
      await invalidateCode.mutateAsync(code.id);
      addToast({
        type: "success",
        message: t("adminPages.redemption.toast.invalidated", { code: code.code }),
      });
    } catch (err) {
      addToast({
        type: "error",
        message: translateError(
          err,
          t("adminPages.redemption.toast.invalidateFailed"),
        ),
      });
    } finally {
      setPendingInvalidateId(null);
      setPendingInvalidate(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
            {t("adminPages.redemption.title")}
          </h1>
          <p className="mt-1 font-text text-meta">
            {t("adminPages.redemption.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={() => setMintOpen(true)}>
          {t("adminPages.redemption.action.mint")}
        </Button>
      </header>

      <nav
        role="tablist"
        aria-label={t("adminPages.redemption.aria.status")}
        className="flex border-b border-subtle"
      >
        {STATUS_TABS.map((t) => {
          const active = t.id === statusFilter;
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
          placeholder={t("adminPages.redemption.placeholder.filter")}
          aria-label={t("adminPages.redemption.aria.filter")}
          className="w-full max-w-sm rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-mono text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:bg-card focus:outline-none"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <RedemptionCodesTable
            rows={items}
            isLoading={codesQuery.isLoading}
            errorMessage={
              codesQuery.error
                ? translateError(codesQuery.error, t("adminPages.redemption.loadFailed"))
                : null
            }
            invalidatingId={pendingInvalidateId}
            onRowClick={(code) => setDrawerCode(code)}
            onInvalidateClick={onInvalidate}
          />
        </Card>
      </motion.div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <MintRedemptionCodeModal
        isOpen={mintOpen}
        onClose={() => setMintOpen(false)}
      />

      <RedemptionCodeDetailDrawer
        isOpen={drawerCode !== null}
        onClose={() => setDrawerCode(null)}
        code={drawerCode}
      />

      <ConfirmDialog
        isOpen={pendingInvalidate !== null}
        onClose={() => setPendingInvalidate(null)}
        onConfirm={onConfirmInvalidate}
        title={t("adminPages.redemption.confirm.invalidateTitle")}
        description={t("adminPages.redemption.confirm.invalidate", {
          code: pendingInvalidate?.code ?? "",
        })}
        confirmLabel={t("adminPages.redemption.confirm.invalidateAction")}
        variant="danger"
        isLoading={pendingInvalidateId !== null}
      />
    </div>
  );
}
