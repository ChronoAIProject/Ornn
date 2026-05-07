/**
 * LlmProvidersSection — list of LLM providers with create / edit /
 * sync. Backed by the per-provider CRUD endpoints under
 * `/api/v1/admin/settings/llm-providers`. Each provider doc carries
 * its own auth (apiKey / tokenUrl / basic), gateway URL, model catalog,
 * and default-model selection.
 *
 * @module pages/admin/settings/sections/LlmProvidersSection
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/stores/toastStore";
import { ProviderEditDrawer } from "@/components/admin/settings/ProviderEditDrawer";
import {
  listLlmProviders,
  syncLlmProviderModels,
  type LlmProvider,
  type LlmSyncResult,
} from "@/services/settingsApi";

export function LlmProvidersSection() {
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<LlmProvider | null>(null);

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
        message: `Synced ${provider?.name ?? id}: +${res.added} added, ${res.updated} updated, ${res.removed} removed.`,
      });
    },
    onError: (err) =>
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Sync failed",
      }),
  });

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (p: LlmProvider) => {
    setEditing(p);
    setDrawerOpen(true);
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            [§ LLM PROVIDERS]
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-strong">
            LLM providers
          </h2>
          <p className="mt-1 font-text text-sm text-meta">
            Per-provider gateway, auth, and model catalog. Multiple providers
            can coexist; pick which one each surface uses in its own settings
            section.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          New provider
        </Button>
      </header>

      <Card>
        {list.isLoading ? (
          <Skeleton lines={4} />
        ) : list.error ? (
          <p className="py-6 text-center font-text text-danger">
            {list.error instanceof Error
              ? list.error.message
              : "Failed to load providers"}
          </p>
        ) : (list.data ?? []).length === 0 ? (
          <div className="py-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
              No providers configured
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={openCreate}
            >
              Add your first provider
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-accent/20">
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Auth
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Models
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Default
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Actions
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
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ProviderEditDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        provider={editing}
      />
    </section>
  );
}

function ProviderRow({
  provider,
  syncing,
  onSync,
  onEdit,
}: {
  provider: LlmProvider;
  syncing: boolean;
  onSync: () => void;
  onEdit: () => void;
}) {
  const enabledCount = provider.models.filter(
    (m) => m.enabled && !m.removed,
  ).length;
  const removedCount = provider.models.filter((m) => m.removed).length;

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
        <span className="text-strong">{enabledCount}</span> enabled ·{" "}
        {provider.models.length - removedCount} active
        {removedCount > 0 && (
          <span className="text-meta"> · {removedCount} removed</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-[11px] text-body">
        {provider.defaultModelId ?? <Badge color="muted">unset</Badge>}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
          >
            Edit
          </button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={syncing}
            onClick={onSync}
          >
            Sync
          </Button>
        </div>
      </td>
    </tr>
  );
}
