/**
 * My NyxID Services Page.
 * Lists the current user's connected AI services from NyxID.
 * @module pages/MyNyxidServicesPage
 */

import { useQuery } from "@tanstack/react-query";
import { PageTransition } from "@/components/layout/PageTransition";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";

const NYXID_API_BASE = import.meta.env.VITE_NYXID_AUTHORIZE_URL?.replace("/oauth/authorize", "") ?? "";

interface UserService {
  id: string;
  service_id: string;
  service_name: string;
  service_slug: string;
  service_category: string;
  label: string;
  is_active: boolean;
  credential_source?: string;
  allowed?: boolean;
  proxy_url?: string;
}

async function fetchMyServices(): Promise<UserService[]> {
  const token = useAuthStore.getState().accessToken;
  if (!token) return [];

  const resp = await fetch(`${NYXID_API_BASE}/api/v1/user-services`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  return data.services ?? [];
}

export function MyNyxidServicesPage() {
  const { data: services, isLoading } = useQuery({
    queryKey: ["nyxid", "my-services"],
    queryFn: fetchMyServices,
  });

  return (
    <PageTransition>
      <div className="py-4">
        <div className="mb-4">
          <h1 className="font-heading text-xl tracking-wider text-text-primary">My NyxID Services</h1>
          <p className="font-body text-sm text-text-muted mt-1">
            Your connected AI services from NyxID
          </p>
        </div>

        {isLoading ? (
          <Skeleton lines={6} />
        ) : !services?.length ? (
          <EmptyState
            title="No services connected"
            description="Connect services in NyxID to see them here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neon-cyan/10">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neon-cyan/10 bg-bg-elevated/50">
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Service</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Label</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Category</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Source</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((svc) => (
                  <tr key={svc.id} className="border-b border-neon-cyan/5 hover:bg-bg-elevated/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-semibold text-neon-cyan">{svc.service_name || svc.service_slug}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-text-primary">{svc.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color="yellow">{svc.service_category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-text-muted">{svc.credential_source ?? "personal"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={svc.is_active ? "green" : "muted"}>
                        {svc.is_active ? "active" : "inactive"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
