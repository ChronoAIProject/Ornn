/**
 * LlmProvidersSection — list of LLM providers with create / edit /
 * sync / per-provider model management. Backed by the per-provider
 * CRUD endpoints under `/api/v1/admin/settings/llm-providers`.
 *
 * Per #270 — single source of truth for model flags. Two drawers:
 *   - `ProviderEditDrawer` for connection-level config (auth, gateway
 *     URL, max-tokens, temperature)
 *   - `ProviderModelsDrawer` for per-model surface flags + per-surface
 *     defaults
 *
 * @module pages/admin/settings/sections/LlmProvidersSection
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToastStore } from "@/stores/toastStore";
import { ProviderEditDrawer } from "@/components/admin/settings/ProviderEditDrawer";
import { ProviderModelsDrawer } from "@/components/admin/settings/ProviderModelsDrawer";
import {
  listLlmProviders,
  syncLlmProviderModels,
  type LlmProvider,
  type LlmSyncResult,
} from "@/services/settingsApi";
import { translateError } from "@/utils/translateError";

export function LlmProvidersSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<LlmProvider | null>(null);
  const [modelsDrawerOpen, setModelsDrawerOpen] = useState(false);
  const [modelsFor, setModelsFor] = useState<LlmProvider | null>(null);

  const list = useQuery({
    queryKey: ["admin", "settings", "llm-providers", "list"] as const,
    queryFn: listLlmProviders,
    staleTime: 60_000,
  });

  const syncMut = useMutation<LlmSyncResult, Error, string>({
    mutationFn: (id) => syncLlmProviderModels(id),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res, id) => {
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "llm-providers"],
      });
      const provider = list.data?.find((p) => p._id === id);
      addToast({
        type: "success",
        message: t("adminSettings.sections.llmProviders.toast.synced", {
          name: provider?.name ?? id,
          added: res.added,
          updated: res.updated,
          removed: res.removed,
        }),
      });
    },
    onError: (err) =>
      addToast({
        type: "error",
        message: translateError(
          err,
          t("adminSettings.sections.llmProviders.toast.syncFailed"),
        ),
      }),
  });

  const openCreate = () => {
    setEditing(null);
    setEditDrawerOpen(true);
  };

  const openEdit = (p: LlmProvider) => {
    setEditing(p);
    setEditDrawerOpen(true);
  };

  const openModels = (p: LlmProvider) => {
    setModelsFor(p);
    setModelsDrawerOpen(true);
  };

  // Keep the models drawer's `provider` prop in sync with the freshly
  // refetched list — when a PATCH lands the list cache is invalidated,
  // so we replace `modelsFor` with the matching row from the new query
  // result on every render of the open drawer. Without this, the user
  // would see stale flags after toggling.
  const liveModelsFor =
    modelsFor && list.data
      ? list.data.find((p) => p._id === modelsFor._id) ?? modelsFor
      : modelsFor;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            {t("adminSettings.sections.llmProviders.eyebrow")}
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-strong">
            {t("adminSettings.sections.llmProviders.title")}
          </h2>
          <p className="mt-1 font-text text-sm text-meta">
            {t("adminSettings.sections.llmProviders.description")}
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          {t("adminSettings.sections.llmProviders.action.new")}
        </Button>
      </header>

      <Card>
        {list.isLoading ? (
          <Skeleton lines={4} />
        ) : list.error ? (
          <p className="py-6 text-center font-text text-danger">
            {translateError(
              list.error,
              t("adminSettings.sections.llmProviders.loadFailed"),
            )}
          </p>
        ) : (list.data ?? []).length === 0 ? (
          <div className="py-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
              {t("adminSettings.sections.llmProviders.empty")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={openCreate}
            >
              {t("adminSettings.sections.llmProviders.action.addFirst")}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-accent/20">
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminSettings.sections.llmProviders.table.name")}
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminSettings.sections.llmProviders.table.auth")}
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminSettings.sections.llmProviders.table.models")}
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminSettings.sections.llmProviders.table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((p) => (
                  <ProviderRow
                    key={p._id}
                    provider={p}
                    syncing={busyId === p._id}
                    onSync={() => syncMut.mutate(p._id)}
                    onEdit={() => openEdit(p)}
                    onModels={() => openModels(p)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ProviderEditDrawer
        isOpen={editDrawerOpen}
        onClose={() => setEditDrawerOpen(false)}
        provider={editing}
      />
      <ProviderModelsDrawer
        isOpen={modelsDrawerOpen}
        onClose={() => setModelsDrawerOpen(false)}
        provider={liveModelsFor}
      />
    </section>
  );
}

function ProviderRow({
  provider,
  syncing,
  onSync,
  onEdit,
  onModels,
}: {
  provider: LlmProvider;
  syncing: boolean;
  onSync: () => void;
  onEdit: () => void;
  onModels: () => void;
}) {
  const { t } = useTranslation();
  const active = provider.models.filter((m) => !m.removed);
  const playground = active.filter((m) => m.enabledForPlayground).length;
  const skillGen = active.filter((m) => m.enabledForSkillGen).length;
  const assistant = active.filter((m) => m.enabledForAssistant).length;
  const removedCount = provider.models.length - active.length;

  return (
    <tr className="border-b border-accent/10 hover:bg-elevated/40">
      <td className="px-4 py-3">
        <p className="font-text text-sm text-strong">{provider.name}</p>
        <p className="font-mono text-[11px] text-meta">{provider.gatewayUrl}</p>
      </td>
      <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-body">
        {provider.auth.kind}
      </td>
      <td className="px-4 py-3 font-mono text-[11px] text-body">
        {t("adminSettings.sections.llmProviders.modelCounts", {
          playground,
          skillGen,
          assistant,
          total: active.length,
        })}
        {removedCount > 0 && (
          <span className="text-meta">
            {" "}
            ·{" "}
            {t("adminSettings.sections.llmProviders.archivedCount", {
              count: removedCount,
            })}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={onModels}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
          >
            {t("adminSettings.sections.llmProviders.action.models")}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
          >
            {t("common.edit")}
          </button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={syncing}
            onClick={onSync}
          >
            {t("adminSettings.sections.llmProviders.action.sync")}
          </Button>
        </div>
      </td>
    </tr>
  );
}
