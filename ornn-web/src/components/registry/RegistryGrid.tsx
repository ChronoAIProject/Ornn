/**
 * RegistryGrid — the shared cards-grid + pagination body for registry-style
 * browse surfaces (skills + skillsets) (#1067).
 *
 * Encapsulates the three render states every registry main column needs —
 * loading (skeleton grid), empty (an `EmptyState` the page supplies), and
 * items (a staggered Framer-Motion grid) — plus the trailing `Pagination`.
 * Generic over the item type via a `renderItem` callback so the skill grid
 * and the skillset grid share identical motion, spacing, and column rules.
 *
 * @module components/registry/RegistryGrid
 */

import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

export interface RegistryGridProps<T> {
  items: T[];
  loading: boolean;
  /** Stable React key for an item (defaults to its array index). */
  getKey?: (item: T, index: number) => string;
  renderItem: (item: T) => ReactNode;
  /** What to show when not loading and there are no items. */
  empty: ReactNode;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Skeleton placeholder count while loading (default 6). */
  skeletonCount?: number;
}

export function RegistryGrid<T>({
  items,
  loading,
  getKey,
  renderItem,
  empty,
  page,
  totalPages,
  onPageChange,
  skeletonCount = 6,
}: RegistryGridProps<T>) {
  return (
    <>
      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 pb-4">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            // Positional list — never reorders, key={i} is intentional (#451).
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        empty
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 pb-4"
        >
          {items.map((item, i) => (
            <motion.div key={getKey ? getKey(item, i) : String(i)} variants={itemVariants}>
              {renderItem(item)}
            </motion.div>
          ))}
        </motion.div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
}
