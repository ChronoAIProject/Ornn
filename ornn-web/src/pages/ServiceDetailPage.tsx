/**
 * Service Detail Page.
 * Shows NyxID service details: name, description, proxy URL, proxied OpenAPI spec URL.
 * @module pages/ServiceDetailPage
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { PageTransition } from "@/components/layout/PageTransition";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/authStore";

const NYXID_API_BASE = import.meta.env.VITE_NYXID_AUTHORIZE_URL?.replace("/oauth/authorize", "") ?? "";

interface ServiceDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  proxyUrl: string;
  openapiProxyUrl: string | null;
  serviceCategory: string;
  isActive: boolean;
  repositoryUrl: string | null;
  homepageUrl: string | null;
}

export function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const source = searchParams.get("source") ?? "admin";

  const [service, setService] = useState<ServiceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken || !id) {
      setIsLoading(false);
      return;
    }

    fetch(`${NYXID_API_BASE}/api/v1/services/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const s = data.service ?? data;
        const hasSpec = !!(s.openapi_spec_url || s.api_spec_url);
        setService({
          id: s.id,
          name: s.name ?? s.slug ?? "Unknown",
          slug: s.slug ?? "",
          description: s.description ?? null,
          proxyUrl: s.slug ? `${NYXID_API_BASE}/api/v1/proxy/s/${s.slug}/{path}` : "",
          openapiProxyUrl: hasSpec && s.slug ? `${NYXID_API_BASE}/api/v1/proxy/s/${s.slug}/api/openapi.json` : null,
          serviceCategory: s.service_category ?? "unknown",
          isActive: s.is_active ?? false,
          repositoryUrl: s.repository_url ?? null,
          homepageUrl: s.homepage_url ?? null,
        });
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("[ServiceDetail]", err);
        setError(err.message);
        setIsLoading(false);
      });
  }, [accessToken, id]);

  if (isLoading) {
    return (
      <PageTransition>
        <div className="py-4">
          <p className="font-body text-sm text-text-muted">Loading...</p>
        </div>
      </PageTransition>
    );
  }

  if (error || !service) {
    return (
      <PageTransition>
        <div className="py-4">
          <p className="font-body text-sm text-neon-red">Failed to load service: {error ?? "Not found"}</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate(-1)}>Back</Button>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="py-4">
        <button
          onClick={() => navigate(source === "my" ? "/services/my" : "/services/admin")}
          className="flex items-center gap-2 font-body text-sm text-text-muted hover:text-neon-cyan transition-colors mb-4 cursor-pointer"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to {source === "my" ? "My Services" : "Admin Services"}
        </button>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-heading text-2xl tracking-wider text-text-primary">{service.name}</h1>
            <Badge color={service.isActive ? "green" : "muted"}>
              {service.isActive ? "active" : "inactive"}
            </Badge>
            <Badge color="yellow">{service.serviceCategory}</Badge>
          </div>
          {service.description && (
            <p className="font-body text-sm text-text-muted">{service.description}</p>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">NyxID Proxy URL</h3>
            <p className="font-mono text-xs text-neon-cyan break-all">{service.proxyUrl}</p>
          </Card>

          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">OpenAPI Spec URL</h3>
            {service.openapiProxyUrl ? (
              <a href={service.openapiProxyUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-neon-cyan hover:underline break-all">
                {service.openapiProxyUrl}
              </a>
            ) : (
              <p className="font-body text-xs text-text-muted italic">No OpenAPI spec configured</p>
            )}
          </Card>

          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">Source Code</h3>
            {service.repositoryUrl ? (
              <a href={service.repositoryUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-neon-cyan hover:underline break-all">
                {service.repositoryUrl}
              </a>
            ) : (
              <p className="font-body text-xs text-text-muted italic">Not configured</p>
            )}
          </Card>

          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">Homepage</h3>
            {service.homepageUrl ? (
              <a href={service.homepageUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-neon-cyan hover:underline break-all">
                {service.homepageUrl}
              </a>
            ) : (
              <p className="font-body text-xs text-text-muted italic">Not configured</p>
            )}
          </Card>
        </div>
      </div>
    </PageTransition>
  );
}
