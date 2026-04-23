/**
 * Error Boundary Component.
 * Catches rendering errors and displays a cyberpunk-themed error page.
 * Provides retry functionality and error reporting.
 * @module components/ErrorBoundary
 */

import { Component, type ReactNode, type ErrorInfo } from "react";
import { motion } from "framer-motion";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback component */
  fallback?: ReactNode;
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Whether to show technical details */
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);

    // Log to console in development
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = "/";
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
          onGoHome={this.handleGoHome}
          showDetails={this.props.showDetails ?? import.meta.env.DEV}
        />
      );
    }

    return this.props.children;
  }
}

export interface ErrorFallbackProps {
  error: Error | null;
  errorInfo?: ErrorInfo | null;
  onRetry?: () => void;
  onReload?: () => void;
  onGoHome?: () => void;
  showDetails?: boolean;
  title?: string;
  message?: string;
}

/** Warning/Error icon */
function GlitchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

/** Refresh icon */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

/** Home icon */
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}

/** Standalone error fallback UI */
export function ErrorFallback({
  error,
  errorInfo,
  onRetry,
  onReload,
  onGoHome,
  showDetails = false,
  title = "SYSTEM MALFUNCTION",
  message = "An unexpected error has occurred in the matrix. The system is attempting to recover.",
}: ErrorFallbackProps) {
  return (
    <div className="min-h-screen bg-bg-deep bg-grid flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="max-w-lg w-full"
      >
        {/* Error card */}
        <div className="glass rounded-xl overflow-hidden border border-neon-red/30 shadow-[0_0_30px_rgba(255,0,60,0.2)]">
          {/* Glitch header */}
          <div className="bg-neon-red/10 border-b border-neon-red/20 px-6 py-4">
            <div className="flex items-center gap-3">
              <motion.div
                animate={{
                  opacity: [1, 0.5, 1],
                  scale: [1, 1.1, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <GlitchIcon className="h-8 w-8 text-neon-red" />
              </motion.div>
              <div>
                <h1 className="font-heading text-xl text-neon-red tracking-wider">
                  {title}
                </h1>
                <p className="font-mono text-xs text-neon-red/70">
                  ERROR_CODE: {error?.name || "UNKNOWN"}
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Message */}
            <p className="font-body text-text-primary leading-relaxed">
              {message}
            </p>

            {/* Error details (dev mode) */}
            {showDetails && error && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <details className="group">
                  <summary className="cursor-pointer font-body text-sm text-text-muted hover:text-neon-cyan transition-colors">
                    View technical details
                  </summary>
                  <div className="mt-3 space-y-3">
                    {/* Error message */}
                    <div className="rounded-lg bg-bg-deep border border-neon-red/20 p-3">
                      <p className="font-mono text-xs text-neon-red break-all">
                        {error.message}
                      </p>
                    </div>

                    {/* Stack trace */}
                    {error.stack && (
                      <div className="rounded-lg bg-bg-deep border border-neon-cyan/10 p-3 max-h-48 overflow-auto">
                        <pre className="font-mono text-xs text-text-muted whitespace-pre-wrap break-all">
                          {error.stack}
                        </pre>
                      </div>
                    )}

                    {/* Component stack */}
                    {errorInfo?.componentStack && (
                      <div className="rounded-lg bg-bg-deep border border-neon-cyan/10 p-3 max-h-32 overflow-auto">
                        <p className="font-mono text-xs text-text-muted mb-1">
                          Component Stack:
                        </p>
                        <pre className="font-mono text-xs text-text-muted/70 whitespace-pre-wrap">
                          {errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              </motion.div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
              {onRetry && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onRetry}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg glass border border-neon-cyan/50 text-neon-cyan font-body text-sm font-semibold transition-all hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)] cursor-pointer"
                >
                  <RefreshIcon className="h-4 w-4" />
                  Try Again
                </motion.button>
              )}

              {onReload && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onReload}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg glass border border-neon-magenta/50 text-neon-magenta font-body text-sm font-semibold transition-all hover:border-neon-magenta hover:shadow-[0_0_15px_rgba(255,140,56,0.3)] cursor-pointer"
                >
                  <RefreshIcon className="h-4 w-4" />
                  Reload Page
                </motion.button>
              )}

              {onGoHome && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onGoHome}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-text-muted font-body text-sm font-semibold transition-colors hover:text-text-primary cursor-pointer"
                >
                  <HomeIcon className="h-4 w-4" />
                  Go Home
                </motion.button>
              )}
            </div>
          </div>

          {/* Decorative scanlines */}
          <div className="scanlines absolute inset-0 pointer-events-none opacity-30" />
        </div>

        {/* Decorative glitch text */}
        <motion.p
          animate={{
            opacity: [0.3, 0.6, 0.3],
            x: [0, 2, -2, 0],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear",
          }}
          className="text-center mt-6 font-mono text-xs text-neon-red/50 tracking-widest"
        >
          ATTEMPTING_RECOVERY... PLEASE_STANDBY
        </motion.p>
      </motion.div>
    </div>
  );
}

/**
 * Higher-order component to wrap components with error boundary.
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, "children">
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${
    Component.displayName || Component.name || "Component"
  })`;

  return WrappedComponent;
}
