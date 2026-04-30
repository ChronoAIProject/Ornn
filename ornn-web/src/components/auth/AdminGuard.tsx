/**
 * Admin Guard Component.
 * Protects routes that require admin permissions.
 * Uses NyxID permission claims from JWT.
 * @module components/auth/AdminGuard
 */

import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuthStore, isAdmin } from "@/stores/authStore";
import { Button } from "@/components/ui/Button";

export interface AdminGuardProps {
  /** Children to render when admin. */
  children?: React.ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const navigate = useNavigate();
  const { isAuthenticated, user, isInitialized, isLoading } = useAuthStore();

  const hasAdminAccess = isAdmin(user);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isInitialized || isLoading) return;

    if (!isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isAuthenticated, isInitialized, isLoading, navigate]);

  // Show nothing while loading
  if (!isInitialized || isLoading) {
    return null;
  }

  // Not authenticated - will be handled by AuthGuard
  if (!isAuthenticated) {
    return null;
  }

  // Not admin - show access denied
  if (!hasAdminAccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-16"
      >
        <div className="glass rounded-xl p-8 text-center max-w-md">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-danger">
              <svg
                className="h-8 w-8 text-danger"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
          </div>
          <h2 className="mb-2 font-display text-xl text-danger">
            Access Denied
          </h2>
          <p className="mb-6 font-text text-meta">
            You do not have permission to access this page. Please contact an
            administrator if you believe this is an error.
          </p>
          <Button variant="primary" onClick={() => navigate("/")}>
            Go to Home
          </Button>
        </div>
      </motion.div>
    );
  }

  // Render children or Outlet
  return children ?? <Outlet />;
}
