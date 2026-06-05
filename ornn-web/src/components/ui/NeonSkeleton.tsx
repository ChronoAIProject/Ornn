/**
 * Neon Skeleton Component.
 * Forge Workshop styled loading skeletons with neon shimmer effect.
 * Composable skeleton variants for different UI elements.
 * @module components/ui/NeonSkeleton
 */

import { motion } from "framer-motion";

export type SkeletonSize = "sm" | "md" | "lg" | "full";
export type SkeletonVariant = "text" | "circular" | "rectangular" | "rounded";

export interface NeonSkeletonProps {
  /** Width of the skeleton */
  width?: string | number;
  /** Height of the skeleton */
  height?: string | number;
  /** Predefined size */
  size?: SkeletonSize;
  /** Shape variant */
  variant?: SkeletonVariant;
  /** Number of lines (for text variant) */
  lines?: number;
  /** Whether to animate */
  animate?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const SIZE_PRESETS = {
  sm: { width: "4rem", height: "1rem" },
  md: { width: "8rem", height: "1.25rem" },
  lg: { width: "12rem", height: "1.5rem" },
  full: { width: "100%", height: "1rem" },
} as const;

const VARIANT_STYLES = {
  text: "rounded-md",
  circular: "rounded-full aspect-square",
  rectangular: "rounded-none",
  rounded: "rounded",
} as const;

/**
 * Base Neon Skeleton component.
 * Renders a single skeleton element with neon shimmer effect.
 */
export function NeonSkeleton({
  width,
  height,
  size = "md",
  variant = "text",
  lines = 1,
  animate = true,
  className = "",
}: NeonSkeletonProps) {
  const sizePreset = SIZE_PRESETS[size];
  const finalWidth = width ?? sizePreset.width;
  const finalHeight = height ?? sizePreset.height;

  const style = {
    width: typeof finalWidth === "number" ? `${finalWidth}px` : finalWidth,
    height: typeof finalHeight === "number" ? `${finalHeight}px` : finalHeight,
  };

  if (lines > 1 && variant === "text") {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          // Positional list — never reorders, key={i} is intentional (#451).
          <div
            key={i}
            className={`skeleton-shimmer ${VARIANT_STYLES[variant]}`}
            style={{
              ...style,
              width: i === lines - 1 ? "75%" : style.width,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`
        ${animate ? "skeleton-shimmer" : "bg-elevated/40"}
        ${VARIANT_STYLES[variant]}
        ${className}
      `}
      style={style}
    />
  );
}

/**
 * Skill Card Skeleton.
 * Loading placeholder for SkillCard component.
 */
export function SkillCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-md border border-subtle bg-card p-6 ${className}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <NeonSkeleton variant="text" width="60%" height="1.5rem" />
        <NeonSkeleton variant="circular" width={32} height={32} />
      </div>

      {/* Description */}
      <NeonSkeleton variant="text" lines={2} size="full" className="mb-4" />

      {/* Tags */}
      <div className="flex gap-2 mb-4">
        <NeonSkeleton variant="rounded" width="4rem" height="1.5rem" />
        <NeonSkeleton variant="rounded" width="5rem" height="1.5rem" />
        <NeonSkeleton variant="rounded" width="3.5rem" height="1.5rem" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-subtle">
        <NeonSkeleton variant="text" width="6rem" height="1rem" />
        <NeonSkeleton variant="text" width="4rem" height="1rem" />
      </div>
    </motion.div>
  );
}
