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

import { useTranslation } from "react-i18next";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";

export function UserManagementPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
          {t("adminPages.userMgmt.title")}
        </h1>
        <p className="mt-1 font-text text-meta">
          {t("adminPages.userMgmt.subtitle")}
        </p>
      </header>

      <AdminUsersTable
        role="admin"
        title={t("adminPages.userMgmt.adminTitle")}
        description={t("adminPages.userMgmt.adminDescription")}
      />

      <AdminUsersTable
        role="normal"
        title={t("adminPages.userMgmt.normalTitle")}
        description={t("adminPages.userMgmt.normalDescription")}
      />
    </div>
  );
}
