/**
 * Page Transition Component.
 * Wraps page content with customizable entrance/exit animations.
 * Follows Forge Workshop design guidelines with fade + slide animations.
 * @module components/layout/PageTransition
 */

import { motion, type Variants, type Transition } from "framer-motion";
import type { ReactNode } from "react";

export type TransitionVariant = "fade" | "slideUp" | "slideDown" | "slideLeft" | "slideRight" | "scale" | "none";

export interface PageTransitionProps {
  children: ReactNode;
  /** Animation variant */
  variant?: TransitionVariant;
  /** Duration in seconds */
  duration?: number;
  /** Delay before animation starts */
  delay?: number;
  /** Whether to animate on exit */
  exitAnimation?: boolean;
  /** Custom easing function */
  ease?: string | number[];
  /** Additional CSS classes */
  className?: string;
}

/** Animation variants for different transition types */
const createVariants = (variant: TransitionVariant): Variants => {
  switch (variant) {
    case "fade":
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      };

    case "slideUp":
      return {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -20 },
      };

    case "slideDown":
      return {
        initial: { opacity: 0, y: -20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 20 },
      };

    case "slideLeft":
      return {
        initial: { opacity: 0, x: 20 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -20 },
      };

    case "slideRight":
      return {
        initial: { opacity: 0, x: -20 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: 20 },
      };

    case "scale":
      return {
        initial: { opacity: 0, scale: 0.95 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
      };

    case "none":
      return {
        initial: {},
        animate: {},
        exit: {},
      };

    default:
      return {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 20 },
      };
  }
};

/** Wraps page content with fade + slide-up entrance animation */
export function PageTransition({
  children,
  variant = "slideUp",
  duration = 0.3,
  delay = 0,
  exitAnimation = true,
  ease = "easeOut",
  className = "",
}: PageTransitionProps) {
  const variants = createVariants(variant);

  const transition: Transition = {
    duration,
    delay,
    ease,
  };

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit={exitAnimation ? "exit" : undefined}
      transition={transition}
      className={`h-full ${className}`}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered children animation container.
 * Animates children with a stagger delay effect.
 */
export interface StaggerContainerProps {
  children: ReactNode;
  /** Delay between each child animation */
  staggerDelay?: number;
  /** Base duration for each child */
  duration?: number;
  /** Animation variant for children */
  variant?: "fade" | "slideUp" | "scale";
  className?: string;
}

const staggerItemVariants = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  slideUp: {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 },
  },
};

export function StaggerContainer({
  children,
  staggerDelay = 0.05,
  className = "",
}: StaggerContainerProps) {
  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: staggerDelay,
      },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger item component.
 * Must be used as a child of StaggerContainer.
 */
export interface StaggerItemProps {
  children: ReactNode;
  /** Animation variant */
  variant?: "fade" | "slideUp" | "scale";
  /** Duration of the animation */
  duration?: number;
  className?: string;
}

export function StaggerItem({
  children,
  variant = "slideUp",
  duration = 0.15,
  className = "",
}: StaggerItemProps) {
  return (
    <motion.div
      variants={staggerItemVariants[variant]}
      transition={{ duration, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Scroll-triggered animation wrapper.
 * Animates when element enters viewport.
 */
export interface ScrollRevealProps {
  children: ReactNode;
  /** Animation variant */
  variant?: TransitionVariant;
  /** Duration in seconds */
  duration?: number;
  /** Viewport threshold (0-1) */
  threshold?: number;
  /** Whether animation should repeat on scroll */
  once?: boolean;
  className?: string;
}

export function ScrollReveal({
  children,
  variant = "slideUp",
  duration = 0.4,
  threshold = 0.2,
  once = true,
  className = "",
}: ScrollRevealProps) {
  const variants = createVariants(variant);

  return (
    <motion.div
      variants={variants}
      initial="initial"
      whileInView="animate"
      viewport={{ once, amount: threshold }}
      transition={{ duration, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Animated presence wrapper for conditional rendering.
 * Provides enter/exit animations for components.
 */
export interface AnimatedPresenceWrapperProps {
  children: ReactNode;
  isVisible: boolean;
  variant?: TransitionVariant;
  duration?: number;
  className?: string;
}

export function AnimatedPresenceWrapper({
  children,
  isVisible,
  variant = "fade",
  duration = 0.2,
  className = "",
}: AnimatedPresenceWrapperProps) {
  const variants = createVariants(variant);

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate={isVisible ? "animate" : "exit"}
      transition={{ duration, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Loading fade transition.
 * Shows content with fade effect after loading completes.
 */
export interface LoadingTransitionProps {
  children: ReactNode;
  isLoading: boolean;
  loadingComponent?: ReactNode;
  duration?: number;
  className?: string;
}

export function LoadingTransition({
  children,
  isLoading,
  loadingComponent,
  duration = 0.3,
  className = "",
}: LoadingTransitionProps) {
  return (
    <div className={className}>
      {isLoading ? (
        loadingComponent
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}
