/**
 * Env-vars drawer body extracted from PlaygroundPage (#453).
 *
 * Per-key input list with a "Set"/"Required" pill on each row + a
 * one-line lock hint when any required key is empty. Stateless — the
 * parent owns the values dict and the change handler.
 *
 * @module components/playground/PlaygroundEnvDrawerBody
 */

import { useTranslation } from "react-i18next";

export interface PlaygroundEnvDrawerBodyProps {
  envVarKeys: string[];
  envVars: Record<string, string>;
  allEnvVarsFilled: boolean;
  onEnvVarChange: (key: string, value: string) => void;
}

export function PlaygroundEnvDrawerBody({
  envVarKeys,
  envVars,
  allEnvVarsFilled,
  onEnvVarChange,
}: PlaygroundEnvDrawerBodyProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header strip — same flat voice as the skill drawer. */}
      <div className="shrink-0 border-b border-subtle bg-elevated/30 px-5 py-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          [§&nbsp;{t("playground.envVars")}]
        </div>
        <p className="mt-2 font-text text-sm leading-relaxed text-body">
          {t("playground.envVarsDesc")}
        </p>
      </div>

      {/* Form */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {envVarKeys.map((key) => {
          const filled = !!envVars[key]?.trim();
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label
                  className="block min-w-0 flex-1 truncate font-mono text-[11px] text-strong"
                  title={key}
                >
                  {key}
                </label>
                <span
                  className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] ${
                    filled ? "text-success" : "text-meta"
                  }`}
                >
                  {filled ? t("common.set") : t("common.required")}
                </span>
              </div>
              <input
                type="text"
                value={envVars[key] ?? ""}
                onChange={(e) => onEnvVarChange(key, e.target.value)}
                placeholder={t("playground.enterValue")}
                className="w-full rounded-sm border border-subtle bg-page px-2.5 py-1.5 font-mono text-xs text-strong placeholder:text-meta/50 focus:border-accent/60 focus:outline-none"
              />
            </div>
          );
        })}
        {!allEnvVarsFilled && (
          <p className="pt-2 font-text text-[11px] leading-relaxed text-meta">
            {t(
              "playground.envVarsLockHint",
              "Chat is locked until every required env var has a value.",
            )}
          </p>
        )}
      </div>
    </div>
  );
}
