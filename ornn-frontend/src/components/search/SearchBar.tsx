import { useSearchStore } from "@/stores/searchStore";
import { useDebounce } from "@/hooks/useDebounce";
import { useEffect, useState } from "react";

export interface SearchBarProps {
  className?: string;
}

export function SearchBar({ className = "" }: SearchBarProps) {
  const setQuery = useSearchStore((s) => s.setQuery);
  const storeQuery = useSearchStore((s) => s.query);
  const [localValue, setLocalValue] = useState(storeQuery);
  const debouncedValue = useDebounce(localValue, 300);

  useEffect(() => {
    setQuery(debouncedValue);
  }, [debouncedValue, setQuery]);

  // Sync from store reset
  useEffect(() => {
    setLocalValue(storeQuery);
  }, [storeQuery]);

  return (
    <div className={`relative ${className}`}>
      <svg
        className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-neon-cyan/50"
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
        placeholder="Search skills by name, description, or tags..."
        className="neon-input w-full rounded-xl py-3 pr-4 pl-12 font-body text-text-primary placeholder:text-text-muted/50"
      />
    </div>
  );
}
