/**
 * SettingsLayout — admin settings shell.
 *
 * Two-column layout: SettingsNav on the left, the active section's form
 * in the right pane via `<Outlet />`. Each section is a self-contained
 * `<form>` that owns its own dirty state + UnsavedChangesGuard.
 *
 * @module pages/admin/settings/SettingsLayout
 */

import { Outlet } from "react-router-dom";
import { SettingsNav } from "@/components/admin/settings/SettingsNav";

export function SettingsLayout() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
          Settings
        </h1>
        <p className="mt-1 font-text text-meta">
          Operator-flippable configuration. Bootstrap envs (DB, encryption
          key, JWT bootstrap) stay in the deployment manifest.
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-64 lg:shrink-0">
          <div className="sticky top-[80px]">
            <SettingsNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
