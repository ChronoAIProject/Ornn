/**
 * Auth Guard Component.
 * Protects routes that require authentication.
 * Uses NyxID OAuth tokens from the auth store.
 * @module components/auth/AuthGuard
 */

import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { Skeleton } from "@/components/ui/Skeleton";

export interface AuthGuardProps {
  /** Children to render when authenticated. */
  children?: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    isAuthenticated,
    isInitialized,
    isLoading,
  } = useAuthStore();

  // initialize() is called at module load in authStore.ts — no need here

  // Redirect based on auth state
  useEffect(() => {
    if (!isInitialized || isLoading) return;

    if (!isAuthenticated) {
      // Redirect to login, preserving intended destination so we can
      // return the user to the page they tried to reach after sign-in.
      navigate("/login", {
        replace: true,
        state: { from: location.pathname },
      });
    }
  }, [isAuthenticated, isInitialized, isLoading, navigate, location.pathname]);

  // Show loading while initializing
  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen bg-page bg-grid">
        <div className="mx-auto max-w-[1280px] px-4 pt-20 pb-12 sm:px-6">
          <div className="space-y-6">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-64 w-full rounded-xl" />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated - will redirect in useEffect
  if (!isAuthenticated) {
    return null;
  }

  // Render children or Outlet
  return children ?? <Outlet />;
}
