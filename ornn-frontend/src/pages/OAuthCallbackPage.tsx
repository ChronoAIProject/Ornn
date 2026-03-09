/**
 * OAuth Callback Page.
 * Handles NyxID OAuth callback by exchanging the authorization code for tokens.
 * @module pages/OAuthCallbackPage
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";

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

      // Clear stored state
      sessionStorage.removeItem("nyxid_oauth_state");

      // Validate params
      if (!code) {
        setState({ status: "error", message: "Missing authorization code" });
        return;
      }

      // Validate state to prevent CSRF
      if (!stateParam || stateParam !== storedState) {
        setState({ status: "error", message: "OAuth state mismatch - possible CSRF attack" });
        return;
      }

      try {
        await useAuthStore.getState().handleNyxIDCallback(code);

        // Redirect to intended destination or home
        const redirectTo = sessionStorage.getItem("login_redirect") || "/";
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
    <div className="min-h-screen bg-bg-deep bg-grid flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full max-w-md"
      >
        {state.status === "loading" && (
          <div className="glass rounded-xl p-8 text-center">
            <div className="mb-4 flex justify-center">
              <span className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-neon-cyan border-t-transparent" />
            </div>
            <h2 className="font-heading text-xl text-neon-cyan">
              Completing Authentication
            </h2>
            <p className="mt-2 font-body text-text-muted">
              Please wait while we verify your account...
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div className="glass rounded-xl p-8 text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-neon-red">
                <svg
                  className="h-6 w-6 text-neon-red"
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
            <h2 className="font-heading text-xl text-neon-red">
              Authentication Failed
            </h2>
            <p className="mt-2 font-body text-text-muted">{state.message}</p>
            <Button
              variant="primary"
              onClick={() => navigate("/login", { replace: true })}
              className="mt-6 w-full"
            >
              Back to Login
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
