/**
 * Service Detail Page.
 * Shows NyxID service details: name, description, proxy URL, OpenAPI spec, endpoints.
 * Works for both admin services and personal services.
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
  baseUrl: string;
  proxyUrl: string;
  serviceCategory: string;
  authMethod: string;
  openapiSpecUrl: string | null;
  repositoryUrl: string | null;
  homepageUrl: string | null;
  isActive: boolean;
  visibility: string;
  streamingSupported: boolean;
}

interface OpenApiEndpoint {
  method: string;
  path: string;
  summary: string;
  tag: string;
}

function parseOpenApiEndpoints(spec: any): OpenApiEndpoint[] {
  const endpoints: OpenApiEndpoint[] = [];
  const paths = spec?.paths ?? {};

  for (const [path, methods] of Object.entries(paths)) {
    if (typeof methods !== "object" || !methods) continue;
    for (const [method, details] of Object.entries(methods as Record<string, any>)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        endpoints.push({
          method: method.toUpperCase(),
          path,
          summary: details?.summary ?? details?.description ?? "",
          tag: (details?.tags?.[0] as string) ?? "",
        });
      }
    }
  }

  return endpoints;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "text-green-400",
  POST: "text-neon-cyan",
  PUT: "text-yellow-400",
  PATCH: "text-yellow-300",
  DELETE: "text-neon-red",
};

export function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const source = searchParams.get("source") ?? "admin"; // "admin" or "my"

  const [service, setService] = useState<ServiceDetail | null>(null);
  const [endpoints, setEndpoints] = useState<OpenApiEndpoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [specLoading, setSpecLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken || !id) {
      setIsLoading(false);
      return;
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    // Fetch from admin services endpoint
    fetch(`${NYXID_API_BASE}/api/v1/services/${id}`, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // Response might be nested under a key or flat
        const s = data.service ?? data;
        const detail: ServiceDetail = {
          id: s.id,
          name: s.name ?? s.slug ?? "Unknown",
          slug: s.slug ?? "",
          description: s.description ?? null,
          baseUrl: s.base_url ?? "",
          proxyUrl: s.slug ? `${NYXID_API_BASE}/api/v1/proxy/s/${s.slug}/{path}` : "",
          serviceCategory: s.service_category ?? "unknown",
          authMethod: s.auth_method ?? "none",
          openapiSpecUrl: s.openapi_spec_url ?? s.api_spec_url ?? null,
          repositoryUrl: s.repository_url ?? null,
          homepageUrl: s.homepage_url ?? null,
          isActive: s.is_active ?? false,
          visibility: s.visibility ?? "public",
          streamingSupported: s.streaming_supported ?? false,
        };
        setService(detail);
        setIsLoading(false);

        // If OpenAPI spec URL exists, fetch via NyxID proxy to avoid mixed content
        if (detail.openapiSpecUrl && detail.slug) {
          setSpecLoading(true);
          const proxySpecUrl = `${NYXID_API_BASE}/api/v1/proxy/s/${detail.slug}/api/openapi.json`;
          fetch(proxySpecUrl, { headers })
            .then((r) => r.ok ? r.json() : null)
            .then((spec) => {
              if (spec) setEndpoints(parseOpenApiEndpoints(spec));
              setSpecLoading(false);
            })
            .catch(() => setSpecLoading(false));
        }
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
      <div className="py-4 h-full flex flex-col">
        {/* Back button */}
        <button
          onClick={() => navigate(source === "my" ? "/services/my" : "/services/admin")}
          className="flex items-center gap-2 font-body text-sm text-text-muted hover:text-neon-cyan transition-colors mb-4 shrink-0 cursor-pointer"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to {source === "my" ? "My Services" : "Admin Services"}
        </button>

        {/* Service header */}
        <div className="mb-6 shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-heading text-2xl tracking-wider text-text-primary">{service.name}</h1>
            <Badge color={service.isActive ? "green" : "muted"}>
              {service.isActive ? "active" : "inactive"}
            </Badge>
            <Badge color="yellow">{service.serviceCategory}</Badge>
            {service.streamingSupported && <Badge color="cyan">streaming</Badge>}
          </div>
          {service.description && (
            <p className="font-body text-sm text-text-muted">{service.description}</p>
          )}
        </div>

        {/* Service info cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 shrink-0">
          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">NyxID Proxy URL</h3>
            <p className="font-mono text-xs text-neon-cyan break-all">{service.proxyUrl || "N/A"}</p>
          </Card>

          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">Internal Base URL</h3>
            <p className="font-mono text-xs text-text-primary break-all">{service.baseUrl || "N/A"}</p>
          </Card>

          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">OpenAPI Spec</h3>
            {service.openapiSpecUrl ? (
              <p className="font-mono text-xs text-neon-cyan break-all">{service.openapiSpecUrl}</p>
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
              <p className="font-body text-xs text-text-muted italic">No repository URL configured</p>
            )}
          </Card>

          {service.homepageUrl && (
            <Card>
              <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">Homepage</h3>
              <a href={service.homepageUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-neon-cyan hover:underline break-all">
                {service.homepageUrl}
              </a>
            </Card>
          )}

          <Card>
            <h3 className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted mb-2">Auth</h3>
            <p className="font-mono text-xs text-text-primary">{service.authMethod} / {service.visibility}</p>
          </Card>
        </div>

        {/* Endpoints list */}
        {service.openapiSpecUrl && (
          <div className="flex-1 min-h-0 flex flex-col">
            <h2 className="font-heading text-sm tracking-wider text-text-primary mb-3 shrink-0">
              API Endpoints {endpoints.length > 0 && `(${endpoints.length})`}
            </h2>

            {specLoading ? (
              <p className="font-body text-sm text-text-muted">Loading spec...</p>
            ) : endpoints.length === 0 ? (
              <p className="font-body text-xs text-text-muted italic">Could not parse endpoints from spec</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-neon-cyan/10">
                <table className="w-full">
                  <thead className="sticky top-0 bg-bg-elevated/95 backdrop-blur-sm">
                    <tr className="border-b border-neon-cyan/10">
                      <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-2 w-20">Method</th>
                      <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-2">Path</th>
                      <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-2">Description</th>
                      <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-2 w-28">Tag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoints.map((ep, idx) => (
                      <tr key={`${ep.method}-${ep.path}-${idx}`} className="border-b border-neon-cyan/5 hover:bg-bg-elevated/30 transition-colors">
                        <td className="px-4 py-2">
                          <span className={`font-mono text-xs font-bold ${METHOD_COLORS[ep.method] ?? "text-text-primary"}`}>
                            {ep.method}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs text-text-primary">{ep.path}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-body text-xs text-text-muted truncate block max-w-md">{ep.summary}</span>
                        </td>
                        <td className="px-4 py-2">
                          {ep.tag && <Badge color="cyan">{ep.tag}</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
