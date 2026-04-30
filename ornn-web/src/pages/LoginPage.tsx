/**
 * Login Page.
 * NyxID OAuth login - redirects to NyxID authorize page.
 *
 * @module pages/LoginPage
 */

import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/authStore";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const { isAuthenticated, loginWithNyxID } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      const redirectTo = (location.state as { from?: string })?.from || "/registry";
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, navigate, location.state]);

  const handleLogin = () => {
    const from = (location.state as { from?: string })?.from;
    if (from) {
      sessionStorage.setItem("login_redirect", from);
    }
    loginWithNyxID();
  };

  return (
    <div className="min-h-screen bg-page bg-grid">
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <div className="mb-8 text-center">
            <h1 className="sr-only">ORNN</h1>
            <Logo className="mx-auto mb-4 h-14 w-auto" />
            <p className="font-text text-sm text-meta">
              {t("login.tagline")}
            </p>
          </div>

          <div className="rounded-md border border-subtle bg-card p-8 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.18)]">
            <div className="space-y-6 text-center">
              <p className="font-text text-sm leading-relaxed text-body">
                {t("login.desc")}
              </p>
              <Button onClick={handleLogin} className="w-full" size="lg">
                {t("login.loginBtn")}
              </Button>
            </div>
          </div>

          <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-meta">
            {t("login.terms")}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
