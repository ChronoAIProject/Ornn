/**
 * LlmProviderConfigCard — admin-only LLM provider override panel.
 *
 * Sits above the model catalog on `/admin/models`. Lets the admin
 * override the default Chrono-LLM-via-NyxID gateway with a custom
 * endpoint + bearer key (e.g. point Ornn at OpenAI direct, an
 * Anthropic proxy, or a self-hosted vLLM).
 *
 * Empty fields fall back to env (`NYX_LLM_GATEWAY_URL` + the SA
 * token-exchange flow). Changes take effect on the next LLM call —
 * no pod restart needed (the resolver is wired into `NyxLlmClient`
 * via `PlatformSettingsService`).
 *
 * @module components/admin/LlmProviderConfigCard
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToastStore } from "@/stores/toastStore";
import {
  fetchPlatformSettings,
  updatePlatformSettings,
  type LlmProviderConfig,
} from "@/services/platformSettingsApi";

/**
 * The backend mid-masks any persisted apiKey on read using the bullet
 * character `•` (`midMaskSecret` in `infra/crypto`). Real bearer keys
 * never contain that character, so any incoming value containing one
 * is the existing key being round-tripped — preserve it server-side.
 */
function isMask(v: string): boolean {
  return v.includes("•");
}

export function LlmProviderConfigCard() {
  const addToast = useToastStore((s) => s.addToast);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LlmProviderConfig>({ gatewayUrl: "", apiKey: "" });
  const [persisted, setPersisted] = useState<LlmProviderConfig>({
    gatewayUrl: "",
    apiKey: "",
  });
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchPlatformSettings();
        if (cancelled) return;
        setPersisted(s.llmProvider);
        setForm(s.llmProvider);
      } catch (err) {
        addToast({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to load LLM provider config",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  const dirty =
    form.gatewayUrl !== persisted.gatewayUrl || form.apiKey !== persisted.apiKey;

  async function handleSave() {
    if (saving || !dirty) return;
    // Trim before submit; unchanged mask is preserved server-side.
    const payload: Partial<LlmProviderConfig> = {
      gatewayUrl: form.gatewayUrl.trim(),
      apiKey: form.apiKey,
    };
    if (payload.gatewayUrl && !isValidHttpUrl(payload.gatewayUrl)) {
      addToast({ type: "error", message: "Gateway URL must be a valid http(s) URL" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlatformSettings({ llmProvider: payload as LlmProviderConfig });
      setPersisted(updated.llmProvider);
      setForm(updated.llmProvider);
      addToast({
        type: "success",
        message: "LLM provider config saved — takes effect on next LLM call",
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save LLM provider config",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleClearKey() {
    setForm((f) => ({ ...f, apiKey: "" }));
  }

  function handleResetToEnv() {
    setForm({ gatewayUrl: "", apiKey: "" });
  }

  return (
    <Card>
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            [§ LLM PROVIDER]
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-strong">
            LLM gateway override
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
          {persisted.gatewayUrl || persisted.apiKey ? "Override active" : "Using env defaults"}
        </span>
      </header>

      {loading ? (
        <Skeleton lines={4} />
      ) : (
        <>
          <p className="mb-4 font-text text-sm leading-relaxed text-body">
            Override the default Chrono LLM gateway. Empty fields fall back
            to the env values baked into the deployment
            (<code className="font-mono text-xs text-meta">NYX_LLM_GATEWAY_URL</code> +
            NyxID SA token-exchange). Changes take effect on the next
            LLM call — no pod restart needed.
          </p>

          {/* Gateway URL */}
          <div className="mb-4 flex flex-col gap-1.5">
            <label
              htmlFor="llm-provider-gateway-url"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta"
            >
              Gateway URL
            </label>
            <input
              id="llm-provider-gateway-url"
              type="url"
              value={form.gatewayUrl}
              onChange={(e) => setForm((f) => ({ ...f, gatewayUrl: e.target.value }))}
              placeholder="https://api.openai.com/v1   (empty = use env default)"
              className="
                w-full rounded-sm border border-subtle bg-elevated/40
                px-3 py-2 font-mono text-xs text-strong
                placeholder:text-meta/60
                transition-colors duration-150
                focus:border-accent focus:outline-none focus:bg-card
              "
            />
            <p className="font-mono text-[10px] text-meta">
              No trailing slash; the client appends <code>/responses</code>.
            </p>
          </div>

          {/* API Key */}
          <div className="mb-4 flex flex-col gap-1.5">
            <label
              htmlFor="llm-provider-api-key"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta"
            >
              API key (Bearer)
            </label>
            <div className="flex items-stretch gap-2">
              <input
                id="llm-provider-api-key"
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder="sk-…   (empty = use SA token-exchange flow)"
                className="
                  flex-1 rounded-sm border border-subtle bg-elevated/40
                  px-3 py-2 font-mono text-xs text-strong
                  placeholder:text-meta/60
                  transition-colors duration-150
                  focus:border-accent focus:outline-none focus:bg-card
                "
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="
                  rounded-sm border border-subtle bg-elevated/40 px-2.5
                  font-mono text-[10px] uppercase tracking-[0.14em] text-meta
                  hover:border-accent hover:text-accent transition-colors
                "
              >
                {showKey ? "Hide" : "Show"}
              </button>
              {form.apiKey && !isMask(form.apiKey) && (
                <button
                  type="button"
                  onClick={handleClearKey}
                  className="
                    rounded-sm border border-subtle bg-elevated/40 px-2.5
                    font-mono text-[10px] uppercase tracking-[0.14em] text-meta
                    hover:border-danger hover:text-danger transition-colors
                  "
                >
                  Clear
                </button>
              )}
            </div>
            <p className="font-mono text-[10px] text-meta">
              When set, the LLM client uses this Bearer token directly
              and skips the NyxID SA token-exchange.
              {isMask(form.apiKey) && " Showing first 4 + last 4 chars of the persisted key — leave masked to keep it, edit to replace."}
            </p>
          </div>

          <footer className="mt-2 flex items-center justify-between border-t border-subtle pt-3">
            <button
              type="button"
              onClick={handleResetToEnv}
              disabled={saving || (!form.gatewayUrl && !form.apiKey)}
              className="
                font-mono text-[11px] uppercase tracking-[0.14em] text-meta
                hover:text-accent transition-colors cursor-pointer
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              Reset to env defaults
            </button>
            <div className="flex items-center gap-3">
              {dirty && (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
                  Unsaved changes
                </span>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </footer>
        </>
      )}
    </Card>
  );
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
