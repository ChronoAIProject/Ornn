/**
 * Phone Number Input Component.
 * Country code selector + number input.
 * @module components/user/PhoneNumberInput
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { COUNTRY_CODES, type PhoneNumber } from "@/types/user";

export interface PhoneNumberInputProps {
  /** Current phone number value. */
  value: PhoneNumber | null;
  /** Called when phone number changes. */
  onChange: (phone: PhoneNumber | null) => void;
  /** Disable input. */
  disabled?: boolean;
  /** Error message. */
  error?: string;
}

export function PhoneNumberInput({
  value,
  onChange,
  disabled = false,
  error,
}: PhoneNumberInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState(
    value?.countryCode || COUNTRY_CODES[0].dialCode
  );
  const [phoneNumber, setPhoneNumber] = useState(value?.number || "");
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Filter countries by search term
  const filteredCountries = COUNTRY_CODES.filter(
    (country) =>
      country.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      country.dialCode.includes(searchTerm)
  );

  const handleCountrySelect = (dialCode: string) => {
    setSelectedCode(dialCode);
    setIsOpen(false);
    setSearchTerm("");

    if (phoneNumber) {
      onChange({ countryCode: dialCode, number: phoneNumber });
    }
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digits, spaces, and dashes
    const cleanValue = e.target.value.replace(/[^\d\s-]/g, "");
    setPhoneNumber(cleanValue);

    if (cleanValue) {
      onChange({ countryCode: selectedCode, number: cleanValue });
    } else {
      onChange(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        {/* Country Code Selector */}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            flex items-center gap-1 rounded-l-lg
            px-3 py-2.5
            bg-page/80 border-b-2 border-r
            font-text text-sm text-strong
            transition-all duration-200
            ${
              error
                ? "border-b-danger border-r-accent/30"
                : "border-b-accent/30 border-r-accent/30"
            }
            ${
              disabled
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer hover:border-b-accent/50"
            }
          `}
        >
          <span className="font-mono">{selectedCode}</span>
          <svg
            className={`h-4 w-4 text-meta transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {/* Phone Number Input */}
        <input
          type="tel"
          value={phoneNumber}
          onChange={handleNumberChange}
          disabled={disabled}
          placeholder="Phone number"
          className={`
            flex-1 rounded-r-lg
            px-4 py-2.5
            bg-page/80 border-b-2
            font-text text-strong
            placeholder:text-meta/50
            transition-all duration-200
            focus:outline-none
            ${
              error
                ? "border-b-danger"
                : "border-b-accent/30 focus:border-b-accent"
            }
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
        />
      </div>

      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="
              absolute left-0 top-full z-50 mt-1
              max-h-64 w-64 overflow-hidden
              rounded
              glass border border-accent/20
              card-impression
            "
          >
            {/* Search Input */}
            <div className="border-b border-accent/10 p-2">
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search country..."
                className="
                  w-full rounded-md
                  bg-page/50 px-3 py-2
                  font-text text-sm text-strong
                  placeholder:text-meta/50
                  focus:outline-none focus:ring-1 focus:ring-accent/50
                "
              />
            </div>

            {/* Country List */}
            <div className="max-h-48 overflow-y-auto">
              {filteredCountries.length > 0 ? (
                filteredCountries.map((country) => (
                  <button
                    key={country.code}
                    type="button"
                    onClick={() => handleCountrySelect(country.dialCode)}
                    className={`
                      flex w-full items-center gap-3 px-3 py-2
                      font-text text-sm text-left
                      transition-colors
                      ${
                        selectedCode === country.dialCode
                          ? "bg-accent/10 text-accent"
                          : "text-strong hover:bg-elevated"
                      }
                    `}
                  >
                    <span className="font-mono text-xs text-meta w-12">
                      {country.dialCode}
                    </span>
                    <span className="truncate">{country.name}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-sm text-meta">
                  No countries found
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
