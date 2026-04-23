/**
 * Settings Page.
 * Simplified for NyxID - profile management is done in NyxID.
 * Only shows current user info, NyxID link, and logout.
 * @module pages/SettingsPage
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { PageTransition } from "@/components/layout/PageTransition";
import { useAuthStore } from "@/stores/authStore";
import { config } from "@/config";

const NYXID_SETTINGS_URL = config.nyxidSettingsUrl;

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, user, logout } = useAuthStore();

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true, state: { from: "/settings" } });
    }
  }, [isAuthenticated, navigate]);

  const handleLogout = () => {
    logout();
  };

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold text-neon-cyan neon-cyan">
              {t("settings.title")}
            </h1>
            <p className="mt-1 font-body text-text-muted">
              {t("settings.subtitle")}
            </p>
          </div>
          <Button variant="danger" onClick={handleLogout}>
            {t("settings.signOut")}
          </Button>
        </div>

        {/* User Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="glass rounded-xl border border-neon-cyan/20 p-6"
        >
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-neon-cyan/20">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="font-heading text-xl text-neon-cyan">
                    {user.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="font-body text-lg font-semibold text-text-primary truncate">
                {user.displayName}
              </p>
              <p className="font-mono text-sm text-text-muted truncate">
                {user.email}
              </p>
              {user.roles.length > 0 && (
                <div className="mt-1 flex gap-1">
                  {user.roles.map((role) => (
                    <span
                      key={role}
                      className="rounded-full bg-neon-cyan/10 px-2 py-0.5 font-body text-xs text-neon-cyan"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* NyxID Settings Link */}
        {NYXID_SETTINGS_URL && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="glass rounded-xl border border-neon-cyan/20 p-6"
          >
            <h3 className="font-heading text-sm uppercase tracking-wider text-text-primary mb-3">
              {t("settings.accountMgmt")}
            </h3>
            <p className="font-body text-sm text-text-muted mb-4">
              {t("settings.accountDesc")}
            </p>
            <a
              href={NYXID_SETTINGS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-neon-cyan/50 px-4 py-2 font-body text-sm font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]"
            >
              {t("settings.openNyxID")}
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          </motion.div>
        )}
      </div>
      </div>
    </PageTransition>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}
