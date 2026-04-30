/**
 * Email Change Card Component.
 * Change primary email with dual OTP verification.
 * @module components/user/EmailChangeCard
 */

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { OtpInput } from "@/components/auth/OtpInput";
import { OTP_CONFIG } from "@/types/auth";

const emailSchema = z.object({
  newEmail: z.string().email("Please enter a valid email address"),
});

type EmailFormData = z.infer<typeof emailSchema>;

export interface EmailChangeCardProps {
  /** Current primary email. */
  currentEmail: string;
  /** Called to initiate email change (sends OTP to current email). */
  onInitChange: () => Promise<void>;
  /** Called to verify OTP sent to current email (server-side). */
  onVerifyOldEmail: (code: string) => Promise<void>;
  /** Called to send OTP to new email. */
  onSendNewEmailOtp: (newEmail: string) => Promise<void>;
  /** Called to confirm email change by verifying new email OTP. */
  onConfirmChange: (newEmail: string, newOtp: string) => Promise<void>;
  /** Disable actions. */
  disabled?: boolean;
}

type ChangeStep = "idle" | "verify_current" | "enter_new" | "verify_new";

export function EmailChangeCard({
  currentEmail,
  onInitChange,
  onVerifyOldEmail,
  onSendNewEmailOtp,
  onConfirmChange,
  disabled = false,
}: EmailChangeCardProps) {
  const [step, setStep] = useState<ChangeStep>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
  });

  // Handle cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setInterval(() => {
        setCooldown((c) => Math.max(0, c - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldown]);

  const handleStartChange = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await onInitChange();
      setStep("verify_current");
      setCooldown(OTP_CONFIG.COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start email change");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCurrentOtpComplete = async (otp: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await onVerifyOldEmail(otp);
      setStep("enter_new");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid or expired OTP code"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewEmailSubmit = async (data: EmailFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      await onSendNewEmailOtp(data.newEmail);
      setNewEmail(data.newEmail);
      setStep("verify_new");
      setCooldown(OTP_CONFIG.COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP to new email");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewOtpComplete = async (otp: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await onConfirmChange(newEmail, otp);
      handleCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change email");
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setStep("idle");
    setNewEmail("");
    setError(null);
    setIsLoading(false);
    reset();
  };

  const handleResendOtp = async () => {
    if (cooldown > 0) return;

    setIsLoading(true);
    setError(null);

    try {
      if (step === "verify_current") {
        await onInitChange();
        setCooldown(OTP_CONFIG.COOLDOWN_SECONDS);
      } else if (step === "verify_new") {
        // Backend stateful design does not support resending OTP to the same
        // new email without consuming a verification attempt. Restart the flow
        // from step 1 so the user re-verifies their current email first.
        await onInitChange();
        setNewEmail("");
        reset();
        setStep("verify_current");
        setCooldown(OTP_CONFIG.COOLDOWN_SECONDS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend OTP");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="mb-6 font-display text-lg text-accent">Primary Email</h2>

      <AnimatePresence mode="wait">
        {step === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="rounded bg-card/50 p-4">
              <p className="font-mono text-sm text-strong">{currentEmail}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-meta">
                Changing your email requires verification of both addresses.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleStartChange}
                disabled={disabled || isLoading}
                loading={isLoading}
              >
                Change Email
              </Button>
            </div>
          </motion.div>
        )}

        {step === "verify_current" && (
          <motion.div
            key="verify_current"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <div className="text-center">
              <p className="font-text text-sm text-meta">
                Enter the 6-digit code sent to
              </p>
              <p className="font-mono text-sm text-accent">{currentEmail}</p>
            </div>

            <OtpInput
              length={OTP_CONFIG.CODE_LENGTH}
              onComplete={handleCurrentOtpComplete}
              disabled={isLoading}
              error={!!error}
            />

            {isLoading && (
              <div className="flex justify-center">
                <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            )}

            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={cooldown > 0 || isLoading}
                className={`
                  font-text text-sm
                  ${
                    cooldown > 0 || isLoading
                      ? "text-meta cursor-not-allowed"
                      : "text-accent hover:underline cursor-pointer"
                  }
                `}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isLoading}
                className="font-text text-sm text-meta hover:text-strong cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {step === "enter_new" && (
          <motion.div
            key="enter_new"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <form onSubmit={handleSubmit(handleNewEmailSubmit)} className="space-y-4">
              <div className="text-center">
                <p className="font-text text-sm text-meta">
                  Enter your new email address
                </p>
              </div>

              <Input
                label="New Email"
                type="email"
                placeholder="your-new@email.com"
                error={errors.newEmail?.message}
                {...register("newEmail")}
              />

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCancel}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={isLoading}
                >
                  Continue
                </Button>
              </div>
            </form>
          </motion.div>
        )}

        {step === "verify_new" && (
          <motion.div
            key="verify_new"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <div className="text-center">
              <p className="font-text text-sm text-meta">
                Enter the 6-digit code sent to
              </p>
              <p className="font-mono text-sm text-accent">{newEmail}</p>
            </div>

            <OtpInput
              length={OTP_CONFIG.CODE_LENGTH}
              onComplete={handleNewOtpComplete}
              disabled={isLoading}
              error={!!error}
            />

            {isLoading && (
              <div className="flex justify-center">
                <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            )}

            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={cooldown > 0 || isLoading}
                className={`
                  font-text text-sm
                  ${
                    cooldown > 0 || isLoading
                      ? "text-meta cursor-not-allowed"
                      : "text-accent hover:underline cursor-pointer"
                  }
                `}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isLoading}
                className="font-text text-sm text-meta hover:text-strong cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded border border-danger/30 bg-danger/10 p-3"
        >
          <p className="text-sm text-danger">{error}</p>
        </motion.div>
      )}
    </Card>
  );
}
