import { useSearchStore } from "@/stores/searchStore";
import { useDebounce } from "@/hooks/useDebounce";
import { useEffect, useState } from "react";

export interface SearchBarProps {
  className?: string;
}

export function SearchBar({ className = "" }: SearchBarProps) {
  const setQuery = useSearchStore((s) => s.setQuery);
  const storeQuery = useSearchStore((s) => s.query);
  const mode = useSearchStore((s) => s.mode);
  const setMode = useSearchStore((s) => s.setMode);
  const [localValue, setLocalValue] = useState(storeQuery);
  const debouncedValue = useDebounce(localValue, 300);

  useEffect(() => {
    setQuery(debouncedValue);
  }, [debouncedValue, setQuery]);

  // Sync from store reset
  useEffect(() => {
    setLocalValue(storeQuery);
  }, [storeQuery]);

  const isSemanticMode = mode === "semantic";

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative flex-1">
        <svg
          className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-accent/50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" strokeWidth="1.5" />
          <path d="M21 21l-4.35-4.35" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          placeholder={
            isSemanticMode
              ? "Describe what you're looking for..."
              : "Search skills by name, description, or tags..."
          }
          className="neon-input w-full rounded-xl py-3 pr-4 pl-12 font-body text-strong placeholder:text-meta/50"
        />
      </div>

      {/* Keyword / Semantic toggle */}
      <button
        type="button"
        onClick={() => setMode(isSemanticMode ? "keyword" : "semantic")}
        title={isSemanticMode ? "Switch to keyword search" : "Switch to semantic search"}
        className={`
          flex items-center gap-2 shrink-0 rounded-xl border px-4 py-3 font-body text-sm transition-all
          ${isSemanticMode
            ? "border-accent-support/50 bg-accent-support/10 text-accent-support hover:bg-accent-support/20"
            : "border-accent/20 bg-elevated text-meta hover:text-strong hover:border-accent/40"
          }
        `}
      >
        {isSemanticMode ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
            />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
            />
          </svg>
        )}
        {isSemanticMode ? "Semantic" : "Keyword"}
      </button>
    </div>
  );
}
