/**
 * API Key Card Component.
 * Generate and manage API keys.
 * @module components/user/ApiKeyCard
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { ApiKeyMeta } from "@/types/auth";

export interface ApiKeyCardProps {
  /** Current API key metadata. */
  apiKey: ApiKeyMeta | null;
  /** Called to generate new API key. */
  onGenerate: () => Promise<string>;
  /** Called to regenerate API key. */
  onRegenerate: () => Promise<string>;
  /** Disable actions. */
  disabled?: boolean;
}

export function ApiKeyCard({
  apiKey,
  onGenerate,
  onRegenerate,
  disabled = false,
}: ApiKeyCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const key = await onGenerate();
      setNewKey(key);
      setShowKeyModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate API key");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const key = await onRegenerate();
      setNewKey(key);
      setShowKeyModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate API key");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!newKey) return;

    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = newKey;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCloseModal = () => {
    setShowKeyModal(false);
    setNewKey(null);
    setCopied(false);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Card className="p-6">
        <h2 className="mb-6 font-display text-lg text-accent">API Key</h2>

        {apiKey ? (
          <div className="space-y-4">
            {/* Key Info */}
            <div className="rounded-lg bg-card/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm text-strong">
                    {apiKey.prefix}...
                  </p>
                  <p className="mt-1 text-xs text-meta">
                    Created: {formatDate(apiKey.createdAt)}
                  </p>
                  <p className="text-xs text-meta">
                    Last used: {formatDate(apiKey.lastUsedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`
                      rounded-full px-2 py-0.5 text-xs font-semibold
                      ${
                        apiKey.status === "active"
                          ? "bg-success/20 text-success"
                          : "bg-danger/20 text-danger"
                      }
                    `}
                  >
                    {apiKey.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Regenerate Button */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-meta">
                Regenerating will invalidate your current key immediately.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRegenerate}
                disabled={disabled || isLoading}
                loading={isLoading}
              >
                Regenerate
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="font-text text-sm text-meta">
              Generate an API key to access the Skill Search API from external
              applications.
            </p>
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={disabled || isLoading}
              loading={isLoading}
            >
              Generate API Key
            </Button>
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3"
          >
            <p className="text-sm text-danger">{error}</p>
          </motion.div>
        )}
      </Card>

      {/* New Key Modal */}
      <Modal
        isOpen={showKeyModal}
        onClose={handleCloseModal}
        title="API Key Generated"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            <p className="text-sm text-warning">
              Make sure to copy your API key now. You will not be able to see it
              again!
            </p>
          </div>

          <div className="relative">
            <div className="rounded-lg bg-page p-4 pr-12 font-mono text-sm text-strong break-all">
              {newKey}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="
                absolute right-2 top-1/2 -translate-y-1/2
                rounded-lg p-2
                text-meta hover:text-accent
                transition-colors
                cursor-pointer
              "
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.svg
                    key="check"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="h-5 w-5 text-success"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </motion.svg>
                ) : (
                  <motion.svg
                    key="copy"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </motion.svg>
                )}
              </AnimatePresence>
            </button>
          </div>

          <Button
            variant="primary"
            onClick={handleCloseModal}
            className="w-full"
          >
            Done
          </Button>
        </div>
      </Modal>
    </>
  );
}
