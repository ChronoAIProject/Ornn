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
import { useTranslation } from "react-i18next";
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
import { translateError } from "@/utils/translateError";

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
  const { t } = useTranslation();
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
      addToast({
        type: "success",
        message: t("adminSettings.sections.exportImport.toast.exported", { filename }),
      });
    } catch (err) {
      addToast({
        type: "error",
        message: translateError(
          err,
          t("adminSettings.sections.exportImport.toast.exportFailed"),
        ),
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
        throw new Error(t("adminSettings.sections.exportImport.invalidFile"));
      }
      setParsedFile(parsed);
    } catch (err) {
      setParseError(
        translateError(
          err,
          t("adminSettings.sections.exportImport.parseFailed"),
        ),
      );
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
        message: translateError(
          err,
          t("adminSettings.sections.exportImport.toast.dryRunFailed"),
        ),
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
            ? t("adminSettings.sections.exportImport.toast.importPartial", { failed })
            : t("adminSettings.sections.exportImport.toast.importApplied"),
      });
    } catch (err) {
      addToast({
        type: "error",
        message: translateError(
          err,
          t("adminSettings.sections.exportImport.toast.importFailed"),
        ),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          {t("adminSettings.sections.exportImport.eyebrow")}
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-strong">
          {t("adminSettings.sections.exportImport.title")}
        </h2>
        <p className="mt-1 font-text text-sm text-meta">
          {t("adminSettings.sections.exportImport.description")}
        </p>
      </header>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-strong">
              {t("adminSettings.sections.exportImport.downloadTitle")}
            </h3>
            <p className="mt-1 font-text text-xs text-meta">
              {t("adminSettings.sections.exportImport.downloadHintPrefix")}{" "}
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
            {t("adminSettings.sections.exportImport.action.export")}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-strong">
                {t("adminSettings.sections.exportImport.uploadTitle")}
              </h3>
              <p className="mt-1 font-text text-xs text-meta">
                {t("adminSettings.sections.exportImport.uploadSteps")}
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
                {t("adminSettings.sections.exportImport.action.chooseFile")}
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
                {t("adminSettings.sections.exportImport.loaded", {
                  schemaVersion: parsedFile.schemaVersion,
                  exportedAt: parsedFile.exportedAt,
                })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={running && !dryRunResult}
                  onClick={runDryRun}
                >
                  {t("adminSettings.sections.exportImport.action.dryRun")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!dryRunResult}
                  onClick={() => setConfirmOpen(true)}
                >
                  {t("adminSettings.sections.exportImport.action.apply")}
                </Button>
              </div>

              {dryRunResult && (
                <ImportResultTable
                  result={dryRunResult}
                  title={t("adminSettings.sections.exportImport.dryRunTitle")}
                />
              )}
            </div>
          )}

          {applyResult && (
            <ImportResultTable
              result={applyResult}
              title={t("adminSettings.sections.exportImport.appliedTitle")}
            />
          )}
        </div>
      </Card>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("adminSettings.sections.exportImport.confirm.title")}
      >
        <p className="font-text text-sm text-body">
          {t("adminSettings.sections.exportImport.confirm.body")}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setConfirmOpen(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            loading={running}
            onClick={apply}
          >
            {t("adminSettings.sections.exportImport.action.applyConfirm")}
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
  const { t } = useTranslation();
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
              {t("adminSettings.sections.exportImport.table.section")}
            </th>
            <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              {t("adminSettings.sections.exportImport.table.status")}
            </th>
            <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              {t("adminSettings.sections.exportImport.table.detail")}
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
