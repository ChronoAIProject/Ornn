/**
 * Skeleton Component.
 * Re-exports from NeonSkeleton for backward compatibility.
 * @module components/ui/Skeleton
 */

import { NeonSkeleton, SkillCardSkeleton as NeonSkillCardSkeleton } from "./NeonSkeleton";

export interface SkeletonProps {
  className?: string;
  lines?: number;
}

/** Neon shimmer skeleton for loading states */
export function Skeleton({ className = "", lines = 1 }: SkeletonProps) {
  return <NeonSkeleton size="full" lines={lines} className={className} />;
}

/** Card-shaped skeleton */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return <NeonSkillCardSkeleton className={className} />;
}

// Re-export all NeonSkeleton components
export {
  NeonSkeleton,
  SkillCardSkeleton,
  TableRowSkeleton,
  ProfileSkeleton,
  ListItemSkeleton,
  DetailPageSkeleton,
  StatsCardSkeleton,
  FormSkeleton,
  SkeletonGrid,
} from "./NeonSkeleton";
