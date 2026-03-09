/**
 * Login Page.
 * NyxID OAuth login - redirects to NyxID authorize page.
 * @module pages/LoginPage
 */

import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/authStore";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const { isAuthenticated, loginWithNyxID } = useAuthStore();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const redirectTo = (location.state as { from?: string })?.from || "/";
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, navigate, location.state]);

  const handleLogin = () => {
    // Store intended destination so we can redirect after callback
    const from = (location.state as { from?: string })?.from;
    if (from) {
      sessionStorage.setItem("login_redirect", from);
    }
    loginWithNyxID();
  };

  return (
    <div className="min-h-screen bg-bg-deep bg-grid">
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          {/* Logo */}
          <div className="mb-8 text-center">
            <img src="/logo.png" alt="ORNN" className="mx-auto h-20 w-20 rounded-xl object-cover mb-4" />
            <h1 className="font-heading text-3xl font-bold tracking-widest text-neon-cyan neon-cyan">
              ORNN
            </h1>
            <p className="mt-2 font-body text-text-muted">
              The Forge for AI Capabilities
            </p>
          </div>

          {/* Glass Card */}
          <div className="glass rounded-xl p-8 border border-neon-cyan/20">
            <div className="text-center space-y-6">
              <p className="font-body text-text-primary">
                Sign in with your NyxID account to access the platform.
              </p>

              <motion.button
                type="button"
                onClick={handleLogin}
                whileTap={{ scale: 0.97 }}
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.1, ease: "easeIn" }}
                className="w-full glass cursor-pointer rounded-lg border border-neon-cyan/50 px-6 py-3.5 font-body text-base font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_20px_rgba(255,107,0,0.3)]"
              >
                Login with NyxID
              </motion.button>
            </div>
          </div>

          {/* Footer */}
          <p className="mt-8 text-center font-body text-xs text-text-muted">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
