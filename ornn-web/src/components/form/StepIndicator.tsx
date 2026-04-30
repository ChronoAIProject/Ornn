/**
 * Step Indicator Component.
 * Visual progress indicator for multi-step forms.
 * Forge Workshop styled with neon accents.
 * @module components/form/StepIndicator
 */

import { motion } from "framer-motion";

export interface Step {
  id: string;
  label: string;
  description?: string;
}

export interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (stepIndex: number) => void;
  /** Whether steps are clickable */
  clickable?: boolean;
  /** Orientation */
  orientation?: "horizontal" | "vertical";
  className?: string;
}

/** Check icon for completed steps */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

export function StepIndicator({
  steps,
  currentStep,
  onStepClick,
  clickable = false,
  orientation = "horizontal",
  className = "",
}: StepIndicatorProps) {
  const isVertical = orientation === "vertical";

  return (
    <div
      className={`
        ${isVertical ? "flex flex-col" : "flex items-center justify-between"}
        ${className}
      `}
    >
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;
        const isClickable = clickable && (isCompleted || index === currentStep);

        return (
          <div
            key={step.id}
            className={`
              ${isVertical ? "flex gap-4" : "flex flex-col items-center"}
              ${index < steps.length - 1 ? (isVertical ? "pb-8" : "flex-1") : ""}
            `}
          >
            {/* Step circle and connector */}
            <div
              className={`
                relative flex items-center
                ${isVertical ? "flex-col" : "w-full"}
              `}
            >
              {/* Connector line (before) */}
              {index > 0 && !isVertical && (
                <div className="flex-1 h-0.5 bg-elevated">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: isCompleted || isCurrent ? 1 : 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="h-full bg-accent origin-left"
                  />
                </div>
              )}

              {/* Step circle */}
              <button
                type="button"
                onClick={() => isClickable && onStepClick?.(index)}
                disabled={!isClickable}
                className={`
                  relative z-10 flex items-center justify-center
                  h-10 w-10 rounded-full border-2 transition-all duration-300
                  ${isClickable ? "cursor-pointer" : "cursor-default"}
                  ${
                    isCompleted
                      ? "bg-accent/20 border-accent text-accent"
                      : isCurrent
                      ? "bg-accent-support/20 border-accent-support text-accent-support"
                      : "bg-elevated border-meta/30 text-meta"
                  }
                `}
              >
                {isCompleted ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <CheckIcon className="h-5 w-5" />
                  </motion.div>
                ) : (
                  <span className="font-display text-sm font-bold">
                    {index + 1}
                  </span>
                )}

                {/* Pulse animation for current step */}
                {isCurrent && (
                  <motion.div
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: 1.5, opacity: 0 }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute inset-0 rounded-full border-2 border-accent-support"
                  />
                )}
              </button>

              {/* Connector line (after) */}
              {index < steps.length - 1 && !isVertical && (
                <div className="flex-1 h-0.5 bg-elevated">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: isCompleted ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="h-full bg-accent origin-left"
                  />
                </div>
              )}

              {/* Vertical connector */}
              {index < steps.length - 1 && isVertical && (
                <div className="absolute top-10 left-1/2 w-0.5 h-8 -translate-x-1/2 bg-elevated">
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: isCompleted ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="h-full bg-accent origin-top"
                  />
                </div>
              )}
            </div>

            {/* Step label */}
            <div
              className={`
                ${isVertical ? "flex-1 pt-0" : "mt-3 text-center"}
              `}
            >
              <p
                className={`
                  font-text text-sm font-medium transition-colors
                  ${isCurrent ? "text-accent-support" : isCompleted ? "text-accent" : "text-meta"}
                `}
              >
                {step.label}
              </p>
              {step.description && (
                <p className="font-text text-xs text-meta mt-0.5">
                  {step.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Compact step indicator for mobile.
 * Shows current step as "Step X of Y".
 */
export interface CompactStepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  currentLabel?: string;
  className?: string;
}

export function CompactStepIndicator({
  currentStep,
  totalSteps,
  currentLabel,
  className = "",
}: CompactStepIndicatorProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Progress bar */}
      <div className="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
          transition={{ duration: 0.3 }}
          className="h-full bg-gradient-to-r from-accent to-accent-support rounded-full"
        />
      </div>

      {/* Step text */}
      <div className="shrink-0 text-right">
        <p className="font-text text-xs text-meta">
          Step {currentStep + 1} of {totalSteps}
        </p>
        {currentLabel && (
          <p className="font-text text-sm text-accent">{currentLabel}</p>
        )}
      </div>
    </div>
  );
}
