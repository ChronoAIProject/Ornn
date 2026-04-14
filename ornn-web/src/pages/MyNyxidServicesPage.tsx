/**
 * My NyxID Services Page.
 * Lists the current user's connected AI services from NyxID.
 * @module pages/MyNyxidServicesPage
 */

import { useState, useEffect } from "react";
import { PageTransition } from "@/components/layout/PageTransition";
import { Badge } from "@/components/ui/Badge";
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
}

export function MyNyxidServicesPage() {
  const [services, setServices] = useState<UserService[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }

    fetch(`${NYXID_API_BASE}/api/v1/user-services`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setServices(data.services ?? []);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("[MyNyxidServices]", err);
        setError(err.message);
        setIsLoading(false);
      });
  }, [accessToken]);

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
          <p className="font-body text-sm text-text-muted">Loading...</p>
        ) : error ? (
          <p className="font-body text-sm text-neon-red">Failed to load services: {error}</p>
        ) : services.length === 0 ? (
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
                {services.map((svc, idx) => (
                  <tr key={svc.id ?? idx} className="border-b border-neon-cyan/5 hover:bg-bg-elevated/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-semibold text-neon-cyan">{String(svc.service_name || svc.service_slug || "")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-text-primary">{String(svc.label || "")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color="yellow">{String(svc.service_category || "unknown")}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-text-muted">{String(svc.credential_source ?? "personal")}</span>
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
