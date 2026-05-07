/**
 * UserManagementPage — admin user listing.
 *
 * Two stacked sections share the same `AdminUsersTable` component but
 * pass different `role` props so the API filters server-side. Splitting
 * admins from normal users at the page level keeps the row count
 * predictable and avoids row-level role badges that admins read more
 * slowly than two clearly-labelled tables.
 *
 * @module pages/admin/UserManagementPage
 */

import { AdminUsersTable } from "@/components/admin/AdminUsersTable";

export function UserManagementPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
          Users
        </h1>
        <p className="mt-1 font-text text-meta">
          Two views: admins (quota-bypass) and normal users. Per-row Grant
          quota link deep-links to the Quota page.
        </p>
      </header>

      <AdminUsersTable
        role="admin"
        title="Admin users"
        description="Carry ornn:admin:skill — bypass all quota counters."
      />

      <AdminUsersTable
        role="normal"
        title="Normal users"
        description="Subject to monthly playground + skill-gen quotas."
      />
    </div>
  );
}
