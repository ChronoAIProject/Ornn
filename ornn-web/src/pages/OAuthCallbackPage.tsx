/**
 * OAuth Callback Page.
 * Handles NyxID OAuth callback by exchanging the authorization code for tokens.
 *
 * @module pages/OAuthCallbackPage
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { logActivity } from "@/services/activityApi";

type CallbackState =
  | { status: "loading" }
  | { status: "error"; message: string };

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>({ status: "loading" });

  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const handleCallback = async () => {
      const code = searchParams.get("code");
      const stateParam = searchParams.get("state");
      const storedState = sessionStorage.getItem("nyxid_oauth_state");

      sessionStorage.removeItem("nyxid_oauth_state");

      if (!code) {
        setState({ status: "error", message: "Missing authorization code" });
        return;
      }

      if (!stateParam || stateParam !== storedState) {
        setState({ status: "error", message: "OAuth state mismatch — possible CSRF attack" });
        return;
      }

      try {
        await useAuthStore.getState().handleNyxIDCallback(code);
        logActivity("login");
        const redirectTo = sessionStorage.getItem("login_redirect") || "/registry";
        sessionStorage.removeItem("login_redirect");
        navigate(redirectTo, { replace: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        setState({ status: "error", message });
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-page bg-grid px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="w-full max-w-md"
      >
        {state.status === "loading" && (
          <div className="rounded-md border border-subtle bg-card p-8 text-center card-impression">
            <div className="mb-4 flex justify-center">
              <span className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-strong">
              Completing authentication
            </h2>
            <p className="mt-2 font-text text-sm text-body">
              Please wait while we verify your account.
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-md border border-danger/40 bg-card p-8 text-center card-impression">
            <div className="mb-4 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-danger bg-danger-soft">
                <svg
                  className="h-6 w-6 text-danger"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
            </div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-danger">
              Authentication failed
            </h2>
            <p className="mt-2 font-text text-sm leading-relaxed text-body">{state.message}</p>
            <Button
              variant="primary"
              onClick={() => navigate("/login", { replace: true })}
              className="mt-6 w-full"
            >
              Back to login
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
