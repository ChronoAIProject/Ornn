/**
 * Linked Accounts Card Component.
 * Manage OAuth provider bindings.
 * @module components/user/LinkedAccountsCard
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { OAuthProvider } from "@/types/user";
import type { OAuthProviderType } from "@/types/auth";

export interface LinkedAccountsCardProps {
  /** Linked OAuth providers. */
  providers: OAuthProvider[];
  /** Whether user has other login methods (email). */
  hasEmailLogin: boolean;
  /** Called to link a provider. */
  onLink: (provider: OAuthProviderType) => Promise<void>;
  /** Called to unlink a provider. */
  onUnlink: (provider: OAuthProviderType) => Promise<void>;
  /** Disable actions. */
  disabled?: boolean;
}

const PROVIDER_INFO = {
  github: {
    name: "GitHub",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    ),
    color: "text-white",
  },
  google: {
    name: "Google",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    ),
    color: "text-white",
  },
} as const;

export function LinkedAccountsCard({
  providers,
  hasEmailLogin,
  onLink,
  onUnlink,
  disabled = false,
}: LinkedAccountsCardProps) {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProviderType | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState<OAuthProviderType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkedProviders = new Map(providers.map((p) => [p.provider, p]));
  const canUnlink = hasEmailLogin || providers.length > 1;

  const handleLink = async (provider: OAuthProviderType) => {
    setLoadingProvider(provider);
    setError(null);

    try {
      await onLink(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link account");
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleUnlink = async () => {
    if (!unlinkConfirm) return;

    setLoadingProvider(unlinkConfirm);
    setError(null);

    try {
      await onUnlink(unlinkConfirm);
      setUnlinkConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink account");
    } finally {
      setLoadingProvider(null);
    }
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return "Unknown";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <>
      <Card className="p-6">
        <h2 className="mb-6 font-display text-lg text-accent">
          Linked Accounts
        </h2>

        <div className="space-y-4">
          {(["github", "google"] as const).map((provider) => {
            const info = PROVIDER_INFO[provider];
            const linked = linkedProviders.get(provider);
            const isLoading = loadingProvider === provider;

            return (
              <div
                key={provider}
                className="flex items-center justify-between rounded-lg bg-card/50 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className={`${info.color}`}>{info.icon}</div>
                  <div>
                    <h3 className="font-text text-sm font-semibold text-strong">
                      {info.name}
                    </h3>
                    {linked ? (
                      <p className="font-mono text-xs text-meta">
                        {linked.email || "Connected"} - Linked{" "}
                        {formatDate(linked.linkedAt)}
                      </p>
                    ) : (
                      <p className="text-xs text-meta">Not connected</p>
                    )}
                  </div>
                </div>

                {linked ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setUnlinkConfirm(provider)}
                    disabled={disabled || isLoading || !canUnlink}
                    loading={isLoading}
                  >
                    Unlink
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleLink(provider)}
                    disabled={disabled || isLoading}
                    loading={isLoading}
                  >
                    Link
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3"
          >
            <p className="text-sm text-danger">{error}</p>
          </motion.div>
        )}

        {!canUnlink && (
          <p className="mt-4 text-xs text-meta">
            You must have at least one login method. Link another account or
            verify an email before unlinking.
          </p>
        )}
      </Card>

      {/* Unlink Confirmation Modal */}
      <Modal
        isOpen={unlinkConfirm !== null}
        onClose={() => setUnlinkConfirm(null)}
        title="Unlink Account"
      >
        <div className="space-y-4">
          <p className="font-text text-strong">
            Are you sure you want to unlink your{" "}
            {unlinkConfirm ? PROVIDER_INFO[unlinkConfirm].name : ""} account?
          </p>
          <p className="font-text text-sm text-meta">
            You will no longer be able to sign in using this account.
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => setUnlinkConfirm(null)}
              disabled={loadingProvider !== null}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleUnlink}
              loading={loadingProvider !== null}
            >
              Unlink
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
