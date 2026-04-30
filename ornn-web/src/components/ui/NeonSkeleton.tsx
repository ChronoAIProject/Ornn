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

/**
 * Table Row Skeleton.
 * Loading placeholder for table rows.
 */
export interface TableRowSkeletonProps {
  columns?: number;
  className?: string;
}

export function TableRowSkeleton({ columns = 5, className = "" }: TableRowSkeletonProps) {
  return (
    <tr className={className}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <NeonSkeleton
            variant="text"
            width={i === 0 ? "80%" : "60%"}
            height="1rem"
          />
        </td>
      ))}
    </tr>
  );
}

/**
 * Profile Skeleton.
 * Loading placeholder for user profiles.
 */
export function ProfileSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {/* Avatar */}
      <NeonSkeleton variant="circular" width={64} height={64} />

      {/* Info */}
      <div className="flex-1 space-y-2">
        <NeonSkeleton variant="text" width="40%" height="1.25rem" />
        <NeonSkeleton variant="text" width="60%" height="1rem" />
        <NeonSkeleton variant="text" width="30%" height="0.875rem" />
      </div>
    </div>
  );
}

/**
 * List Item Skeleton.
 * Loading placeholder for list items.
 */
export function ListItemSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 p-3 ${className}`}>
      <NeonSkeleton variant="rounded" width={40} height={40} />
      <div className="flex-1 space-y-1.5">
        <NeonSkeleton variant="text" width="70%" height="1rem" />
        <NeonSkeleton variant="text" width="40%" height="0.75rem" />
      </div>
    </div>
  );
}

/**
 * Detail Page Skeleton.
 * Loading placeholder for detail/view pages.
 */
export function DetailPageSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="space-y-4">
        <NeonSkeleton variant="text" width="50%" height="2rem" />
        <NeonSkeleton variant="text" lines={2} size="full" />
      </div>

      {/* Meta info */}
      <div className="flex flex-wrap gap-4">
        <NeonSkeleton variant="rounded" width="6rem" height="1.5rem" />
        <NeonSkeleton variant="rounded" width="8rem" height="1.5rem" />
        <NeonSkeleton variant="rounded" width="5rem" height="1.5rem" />
      </div>

      {/* Main content card */}
      <div className="rounded-md border border-subtle bg-card p-6 space-y-4">
        <NeonSkeleton variant="text" width="30%" height="1.25rem" />
        <NeonSkeleton variant="text" lines={4} size="full" />
        <NeonSkeleton variant="rounded" width="100%" height="12rem" />
      </div>

      {/* Secondary cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-md border border-subtle bg-card p-6 space-y-3">
          <NeonSkeleton variant="text" width="40%" height="1.25rem" />
          <NeonSkeleton variant="text" lines={3} size="full" />
        </div>
        <div className="rounded-md border border-subtle bg-card p-6 space-y-3">
          <NeonSkeleton variant="text" width="40%" height="1.25rem" />
          <NeonSkeleton variant="text" lines={3} size="full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Stats Card Skeleton.
 * Loading placeholder for dashboard stat cards.
 */
export function StatsCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-md border border-subtle bg-card p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <NeonSkeleton variant="text" width="40%" height="1rem" />
        <NeonSkeleton variant="circular" width={32} height={32} />
      </div>
      <NeonSkeleton variant="text" width="60%" height="2rem" className="mb-2" />
      <NeonSkeleton variant="text" width="30%" height="0.875rem" />
    </div>
  );
}

/**
 * Form Skeleton.
 * Loading placeholder for form sections.
 */
export function FormSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Field 1 */}
      <div className="space-y-2">
        <NeonSkeleton variant="text" width="20%" height="0.875rem" />
        <NeonSkeleton variant="rounded" width="100%" height="2.5rem" />
      </div>

      {/* Field 2 */}
      <div className="space-y-2">
        <NeonSkeleton variant="text" width="25%" height="0.875rem" />
        <NeonSkeleton variant="rounded" width="100%" height="2.5rem" />
      </div>

      {/* Field 3 (textarea) */}
      <div className="space-y-2">
        <NeonSkeleton variant="text" width="15%" height="0.875rem" />
        <NeonSkeleton variant="rounded" width="100%" height="6rem" />
      </div>

      {/* Button */}
      <NeonSkeleton variant="rounded" width="8rem" height="2.5rem" />
    </div>
  );
}

/**
 * Grid of Skeleton Cards.
 * Renders multiple skeleton cards in a responsive grid.
 */
export interface SkeletonGridProps {
  count?: number;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

export function SkeletonGrid({ count = 6, columns = 3, className = "" }: SkeletonGridProps) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  };

  return (
    <div className={`grid gap-6 ${gridCols[columns]} ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkillCardSkeleton key={i} />
      ))}
    </div>
  );
}
