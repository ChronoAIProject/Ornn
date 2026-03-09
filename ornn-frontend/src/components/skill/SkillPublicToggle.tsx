/**
 * Toggle component for skill public/private status.
 * Shows confirmation modal before toggling.
 * Uses the PUT /api/skills/{id} endpoint with { isPrivate } body.
 * @module components/skill/SkillPublicToggle
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useUpdateSkill } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";

export interface SkillPublicToggleProps {
  skillId: string;
  isPrivate: boolean;
  /** Callback after successful toggle */
  onToggle?: (isNowPrivate: boolean) => void;
  /** Disable the toggle */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  className?: string;
}

export function SkillPublicToggle({
  skillId,
  isPrivate,
  onToggle,
  disabled = false,
  size = "md",
  className = "",
}: SkillPublicToggleProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const updateMutation = useUpdateSkill(skillId);
  const addToast = useToastStore((s) => s.addToast);

  const isPublic = !isPrivate;

  const handleToggle = async () => {
    try {
      await updateMutation.mutateAsync({ isPrivate: !isPrivate });
      const isNowPrivate = !isPrivate;
      addToast({
        type: "success",
        message: isNowPrivate
          ? "Skill is now private. Only you can view it."
          : "Skill is now public. All users can view it.",
      });
      onToggle?.(isNowPrivate);
    } catch {
      addToast({
        type: "error",
        message: "Failed to update skill visibility",
      });
    } finally {
      setShowConfirm(false);
    }
  };

  const toggleWidth = size === "sm" ? "w-10" : "w-12";
  const toggleHeight = size === "sm" ? "h-5" : "h-6";
  const knobSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const translateX = size === "sm" ? 18 : 22;

  return (
    <>
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-xs font-body text-text-muted uppercase tracking-wide">
          {isPublic ? "Public" : "Private"}
        </span>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={disabled || updateMutation.isPending}
          className={`
            relative ${toggleWidth} ${toggleHeight} rounded-full
            transition-all duration-200
            ${isPublic
              ? "bg-neon-green/20 border border-neon-green/50 shadow-[0_0_8px_rgba(57,255,20,0.3)]"
              : "bg-bg-elevated border border-neon-cyan/30"
            }
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-neon-cyan"}
            focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep
          `}
          aria-label={isPublic ? "Make skill private" : "Make skill public"}
        >
          <motion.div
            initial={false}
            animate={{ x: isPublic ? translateX : 2 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={`
              absolute top-0.5 ${knobSize} rounded-full
              ${isPublic
                ? "bg-neon-green shadow-[0_0_6px_rgba(57,255,20,0.6)]"
                : "bg-neon-cyan/60"
              }
            `}
          />
        </button>
      </div>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={isPublic ? "Make Skill Private?" : "Make Skill Public?"}
      >
        <div className="space-y-4">
          <p className="font-body text-text-primary">
            {isPublic
              ? "Are you sure you want to make this skill private? Other users will no longer be able to view it."
              : "Are you sure you want to make this skill public? All users will be able to view it."}
          </p>

          <div className="glass rounded-lg p-4 border border-neon-cyan/10">
            <div className="flex items-center gap-3">
              <div className={`
                w-3 h-3 rounded-full
                ${isPublic ? "bg-neon-cyan" : "bg-neon-green shadow-[0_0_8px_rgba(57,255,20,0.5)]"}
              `} />
              <span className="font-body text-sm">
                {isPublic
                  ? "Skill will become private"
                  : "Skill will become public"}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleToggle}
              loading={updateMutation.isPending}
            >
              {isPublic ? "Make Private" : "Make Public"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
