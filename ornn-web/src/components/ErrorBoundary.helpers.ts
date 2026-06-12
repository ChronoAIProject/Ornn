/**
 * ErrorBoundary HOC, split out of ErrorBoundary.tsx so the component
 * file only exports components — required for react-refresh / Fast
 * Refresh (#888). Written with `createElement` (no JSX) so this stays a
 * plain `.ts` module and is not a Fast Refresh boundary itself.
 *
 * @module components/ErrorBoundary.helpers
 */

import { createElement, type ComponentType } from "react";
import { ErrorBoundary, type ErrorBoundaryProps } from "./ErrorBoundary";

/**
 * Higher-order component to wrap components with error boundary.
 */
export function withErrorBoundary<P extends object>(
  Component: ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, "children">,
) {
  const WrappedComponent = (props: P) =>
    // `children` is supplied positionally (3rd arg), so the props object
    // legitimately omits it — cast past createElement's prop typing,
    // which can't see the positional children.
    createElement(
      ErrorBoundary,
      (errorBoundaryProps ?? null) as ErrorBoundaryProps | null,
      createElement(Component, props),
    );

  WrappedComponent.displayName = `withErrorBoundary(${
    Component.displayName || Component.name || "Component"
  })`;

  return WrappedComponent;
}
