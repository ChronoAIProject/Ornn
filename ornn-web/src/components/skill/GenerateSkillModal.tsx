/**
 * Generate Skill Modal.
 * Reference selection + generation progress UI.
 * @module components/skill/GenerateSkillModal
 */

import { useState, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/authStore";
import { apiPost } from "@/services/apiClient";

interface Reference {
  id: string;
  type: "openapi" | "source" | "homepage" | "url" | "markdown";
  label: string;
  value: string; // URL or markdown content
  selected: boolean;
  auto: boolean; // auto-detected from service
}

interface GenerateSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (skillName: string) => void;
  serviceId: string;
  serviceName: string;
  proxyUrl: string;
  openapiSpecUrl: string | null;
  repositoryUrl: string | null;
  homepageUrl: string | null;
}

type GenerationStep = "select" | "generating" | "done" | "error";

const STEP_MESSAGES: Record<string, string> = {
  fetching_spec: "Fetching OpenAPI spec...",
  fetching_refs: "Fetching reference content...",
  generating: "Generating skill package with AI...",
  validating: "Validating skill format...",
  packaging: "Packaging and uploading skill...",
  done: "Skill generated successfully!",
};

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

export function GenerateSkillModal({
  isOpen,
  onClose,
  onSuccess,
  serviceId,
  serviceName,
  proxyUrl,
  openapiSpecUrl,
  repositoryUrl,
  homepageUrl,
}: GenerateSkillModalProps) {
  // Build initial references from service data
  const buildInitialRefs = (): Reference[] => {
    const refs: Reference[] = [];
    if (openapiSpecUrl) {
      refs.push({ id: "openapi", type: "openapi", label: "OpenAPI Spec", value: openapiSpecUrl, selected: true, auto: true });
    }
    if (repositoryUrl) {
      refs.push({ id: "source", type: "source", label: "Source Code", value: repositoryUrl, selected: true, auto: true });
    }
    if (homepageUrl) {
      refs.push({ id: "homepage", type: "homepage", label: "Homepage", value: homepageUrl, selected: true, auto: true });
    }
    return refs;
  };

  const [references, setReferences] = useState<Reference[]>(buildInitialRefs);
  const [step, setStep] = useState<GenerationStep>("select");
  const [currentStepMsg, setCurrentStepMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  const toggleRef = (id: string) => {
    setReferences((prev) => prev.map((r) => r.id === id ? { ...r, selected: !r.selected } : r));
  };

  const removeRef = (id: string) => {
    setReferences((prev) => prev.filter((r) => r.id !== id || r.auto));
  };

  const addUrl = () => {
    const url = newUrl.trim();
    if (!url) return;
    if (!isValidUrl(url)) {
      setUrlError("Please enter a valid URL");
      return;
    }
    if (references.some((r) => r.value === url)) {
      setUrlError("This URL is already added");
      return;
    }
    setReferences((prev) => [
      ...prev,
      { id: `url-${Date.now()}`, type: "url", label: url, value: url, selected: true, auto: false },
    ]);
    setNewUrl("");
    setUrlError("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".md")) {
      setUrlError("Only .md (markdown) files are supported");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      setReferences((prev) => [
        ...prev,
        { id: `md-${Date.now()}`, type: "markdown", label: file.name, value: content, selected: true, auto: false },
      ]);
      setUrlError("");
    };
    reader.readAsText(file);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGenerate = async () => {
    setStep("generating");
    setErrorMsg("");

    try {
      const selectedRefs = references.filter((r) => r.selected);

      // Step 1: Fetch OpenAPI spec content if selected
      let specContent: string | null = null;
      const openapiRef = selectedRefs.find((r) => r.type === "openapi");
      if (openapiRef) {
        setCurrentStepMsg(STEP_MESSAGES.fetching_spec);
        try {
          const specResp = await fetch(openapiRef.value, {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
          });
          if (specResp.ok) {
            const specJson = await specResp.json();
            specContent = JSON.stringify(specJson, null, 2);
          }
        } catch {
          // Non-fatal: spec fetch failed, continue without it
        }
      }

      // Step 2: Build references for the prompt
      setCurrentStepMsg(STEP_MESSAGES.fetching_refs);
      const promptRefs: Array<{ type: string; content: string }> = [];

      for (const ref of selectedRefs) {
        if (ref.type === "openapi" && specContent) {
          promptRefs.push({ type: "openapi_spec", content: specContent });
        } else if (ref.type === "source") {
          promptRefs.push({ type: "source_code_url", content: ref.value });
        } else if (ref.type === "homepage") {
          promptRefs.push({ type: "homepage_url", content: ref.value });
        } else if (ref.type === "url") {
          promptRefs.push({ type: "reference_url", content: ref.value });
        } else if (ref.type === "markdown") {
          promptRefs.push({ type: "markdown_content", content: ref.value });
        }
      }

      // Step 3: Call generate endpoint
      setCurrentStepMsg(STEP_MESSAGES.generating);

      const res = await apiPost<{ guid: string; name: string; serviceId: string }>(
        `/api/v1/admin/system-skills/${serviceId}/generate`,
        {
          userToken: accessToken,
          proxyUrl,
          references: promptRefs,
          serviceName,
        },
      );

      if (!res.data) {
        throw new Error("Generation returned no data");
      }

      setCurrentStepMsg(STEP_MESSAGES.done);
      setStep("done");

      // Short delay then redirect
      setTimeout(() => {
        onSuccess(res.data!.name);
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message ?? "Generation failed");
      setStep("error");
    }
  };

  const handleClose = () => {
    if (step === "generating") return; // Don't close during generation
    setStep("select");
    setReferences(buildInitialRefs());
    setNewUrl("");
    setUrlError("");
    setErrorMsg("");
    onClose();
  };

  return (
    <Modal isOpen={isOpen} title="Generate Skill" onClose={handleClose}>
      {step === "select" && (
        <div className="space-y-4">
          <p className="font-body text-sm text-meta">
            Select references to include in skill generation for <strong className="text-strong">{serviceName}</strong>.
          </p>

          {/* Reference list */}
          <div className="space-y-2">
            {references.map((ref) => (
              <div key={ref.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-accent/10 bg-elevated/30">
                <input
                  type="checkbox"
                  checked={ref.selected}
                  onChange={() => toggleRef(ref.id)}
                  className="accent-accent shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge color={ref.type === "openapi" ? "green" : ref.type === "markdown" ? "cyan" : "yellow"}>
                      {ref.type === "openapi" ? "spec" : ref.type === "source" ? "repo" : ref.type === "homepage" ? "home" : ref.type === "markdown" ? "md" : "url"}
                    </Badge>
                    <span className="font-mono text-xs text-strong truncate">{ref.label}</span>
                  </div>
                </div>
                {!ref.auto && (
                  <button onClick={() => removeRef(ref.id)} className="text-meta hover:text-danger text-xs cursor-pointer">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add custom reference */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={newUrl}
                onChange={(e) => { setNewUrl(e.target.value); setUrlError(""); }}
                placeholder="Add reference URL..."
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && addUrl()}
              />
              <Button size="sm" variant="secondary" onClick={addUrl}>Add</Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                Upload .md file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
            {urlError && <p className="font-body text-xs text-danger">{urlError}</p>}
          </div>

          {/* Proceed */}
          <div className="flex justify-end gap-3 pt-2 border-t border-accent/10">
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={references.filter((r) => r.selected).length === 0}>
              Proceed
            </Button>
          </div>
        </div>
      )}

      {step === "generating" && (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          {/* Spinner */}
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-2 border-accent/20 rounded-full" />
            <div className="absolute inset-0 border-2 border-transparent border-t-accent rounded-full animate-spin" />
          </div>
          <p className="font-body text-sm text-strong">{currentStepMsg}</p>
          <p className="font-body text-xs text-meta">This may take 30-60 seconds...</p>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="w-12 h-12 rounded-full bg-forge-green/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-forge-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-body text-sm text-strong">Skill generated successfully!</p>
          <p className="font-body text-xs text-meta">Redirecting to System Skills...</p>
        </div>
      )}

      {step === "error" && (
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <p className="font-body text-sm text-strong">Generation failed</p>
              <p className="font-body text-xs text-danger">{errorMsg}</p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={handleClose}>Close</Button>
            <Button onClick={() => { setStep("select"); setErrorMsg(""); }}>Try Again</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
