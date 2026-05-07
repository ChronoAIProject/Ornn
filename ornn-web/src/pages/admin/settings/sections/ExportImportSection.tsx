/**
 * ExportImportSection — whole-config download + upload.
 *
 * Download triggers `/admin/settings/export` and saves a JSON attachment.
 * Upload reads a local file, parses it, runs an optional dry-run import
 * to surface a per-section diff, and then commits via a confirm modal.
 *
 * Secrets in the exported file are sentinel-redacted (`<REDACTED:fieldName>`).
 * On import, sentinel values preserve the existing DB secret; plaintext
 * values overwrite.
 *
 * @module pages/admin/settings/sections/ExportImportSection
 */

import { useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/stores/toastStore";
import {
  downloadSettingsExport,
  importSettings,
  type SectionImportResult,
  type SettingsExport,
  type SettingsImportResponse,
} from "@/services/settingsApi";

function downloadAsFile(body: SettingsExport, filename: string) {
  const blob = new Blob([JSON.stringify(body, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportImportSection() {
  const addToast = useToastStore((s) => s.addToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [parsedFile, setParsedFile] = useState<SettingsExport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<SettingsImportResponse | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyResult, setApplyResult] = useState<SettingsImportResponse | null>(
    null,
  );

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { body, filename } = await downloadSettingsExport();
      downloadAsFile(body, filename);
      addToast({ type: "success", message: `Exported ${filename}` });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Export failed",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleFile = async (file: File | null) => {
    setParsedFile(null);
    setParseError(null);
    setDryRunResult(null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SettingsExport;
      if (typeof parsed.schemaVersion !== "number" || !parsed.sections) {
        throw new Error(
          "File is not a valid Ornn settings export (missing schemaVersion or sections)",
        );
      }
      setParsedFile(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parse failed");
    }
  };

  const runDryRun = async () => {
    if (!parsedFile) return;
    setRunning(true);
    try {
      const result = await importSettings({
        schemaVersion: parsedFile.schemaVersion,
        sections: parsedFile.sections,
        dryRun: true,
      });
      setDryRunResult(result);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Dry-run failed",
      });
    } finally {
      setRunning(false);
    }
  };

  const apply = async () => {
    if (!parsedFile) return;
    setRunning(true);
    try {
      const result = await importSettings({
        schemaVersion: parsedFile.schemaVersion,
        sections: parsedFile.sections,
        dryRun: false,
      });
      setApplyResult(result);
      setConfirmOpen(false);
      const failed = Object.values(result.sections).filter(
        (s) => s.status === "failed",
      ).length;
      addToast({
        type: failed > 0 ? "warning" : "success",
        message:
          failed > 0
            ? `Import partial — ${failed} section(s) failed.`
            : "Import applied.",
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Import failed",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          [§ EXPORT / IMPORT]
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-strong">
          Export / import
        </h2>
        <p className="mt-1 font-text text-sm text-meta">
          Download the full settings tree as JSON, or import to apply a
          previously-exported configuration. Secrets in the export are
          sentinel-redacted; importing a sentinel preserves the existing
          DB value.
        </p>
      </header>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-strong">
              Download
            </h3>
            <p className="mt-1 font-text text-xs text-meta">
              File name follows{" "}
              <code className="font-mono text-[11px] text-strong">
                ornn-settings-&lt;iso&gt;.json
              </code>
              .
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            loading={downloading}
            onClick={handleDownload}
          >
            Export settings
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-strong">
                Upload + import
              </h3>
              <p className="mt-1 font-text text-xs text-meta">
                Step 1: upload. Step 2: dry-run. Step 3: confirm + apply.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                Choose file
              </Button>
            </div>
          </div>

          {parseError && (
            <p
              role="alert"
              className="rounded border border-danger/40 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger"
            >
              {parseError}
            </p>
          )}

          {parsedFile && (
            <div className="space-y-3 rounded border border-subtle bg-elevated/40 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
                Loaded · schemaVersion {parsedFile.schemaVersion} · exported{" "}
                {parsedFile.exportedAt}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={running && !dryRunResult}
                  onClick={runDryRun}
                >
                  Run dry-run preview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!dryRunResult}
                  onClick={() => setConfirmOpen(true)}
                >
                  Apply import
                </Button>
              </div>

              {dryRunResult && (
                <ImportResultTable result={dryRunResult} title="Dry-run preview" />
              )}
            </div>
          )}

          {applyResult && (
            <ImportResultTable
              result={applyResult}
              title="Import applied"
            />
          )}
        </div>
      </Card>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Apply import?"
      >
        <p className="font-text text-sm text-body">
          This will write every section that passes validation. Sections
          that fail validation are skipped — the rest still apply.
          Sentinel-valued secrets keep the existing DB value.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            loading={running}
            onClick={apply}
          >
            Apply
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function ImportResultTable({
  result,
  title,
}: {
  result: SettingsImportResponse;
  title: string;
}) {
  const entries = Object.entries(result.sections);
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
        {title} · {result.aggregateStatus}
      </p>
      <table className="mt-2 w-full">
        <thead>
          <tr className="border-b border-accent/20">
            <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Section
            </th>
            <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Status
            </th>
            <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Detail
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, val]) => (
            <ImportRow key={key} section={key} val={val} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportRow({
  section,
  val,
}: {
  section: string;
  val: SectionImportResult;
}) {
  const tone =
    val.status === "applied"
      ? "text-success"
      : val.status === "skipped"
      ? "text-meta"
      : "text-danger";
  const detail =
    val.errors && val.errors.length > 0
      ? val.errors.map((e) => `${e.field}: ${e.message}`).join("; ")
      : (val.changedFields ?? []).join(", ") || "—";
  return (
    <tr className="border-b border-accent/10">
      <td className="px-3 py-2 font-mono text-[11px] text-strong">{section}</td>
      <td
        className={`px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${tone}`}
      >
        {val.status}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-body">{detail}</td>
    </tr>
  );
}
