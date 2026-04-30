/**
 * Streaming Token Display Component.
 * Renders accumulated tokens from an SSE stream with a blinking cursor.
 * @module components/ui/StreamingTokenDisplay
 */

export interface StreamingTokenDisplayProps {
  tokens: string;
  className?: string;
}

export function StreamingTokenDisplay({ tokens, className = "" }: StreamingTokenDisplayProps) {
  return (
    <div
      className={`rounded-lg border border-accent/10 bg-page p-4 font-mono text-sm text-strong ${className}`}
    >
      <pre className="whitespace-pre-wrap break-words">
        {tokens}
        <span className="inline-block h-4 w-0.5 animate-pulse bg-accent ml-0.5" />
      </pre>
    </div>
  );
}
