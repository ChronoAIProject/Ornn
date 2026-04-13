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
      className={`rounded-lg border border-neon-cyan/10 bg-bg-deep p-4 font-mono text-sm text-text-primary ${className}`}
    >
      <pre className="whitespace-pre-wrap break-words">
        {tokens}
        <span className="inline-block h-4 w-0.5 animate-pulse bg-neon-cyan ml-0.5" />
      </pre>
    </div>
  );
}
