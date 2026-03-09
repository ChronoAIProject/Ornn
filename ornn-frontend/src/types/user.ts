/**
 * User-related type definitions.
 * Simplified for NyxID - user profile is managed in NyxID.
 * @module types/user
 */

/**
 * Minimal user info derived from NyxID JWT claims.
 * Full user profile management is in NyxID, not ornn.
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  bio?: string;
  primaryEmail?: string;
  roles: string[];
  permissions: string[];
}

export interface PhoneNumber {
  countryCode: string;
  number: string;
}

export interface OAuthProvider {
  type: string;
  provider: string;
  id: string;
  email?: string;
  displayName?: string;
  linkedAt?: string;
}

export const COUNTRY_CODES = [
  { code: "US", dialCode: "+1", name: "United States", flag: "🇺🇸" },
  { code: "GB", dialCode: "+44", name: "United Kingdom", flag: "🇬🇧" },
  { code: "CN", dialCode: "+86", name: "China", flag: "🇨🇳" },
  { code: "JP", dialCode: "+81", name: "Japan", flag: "🇯🇵" },
  { code: "KR", dialCode: "+82", name: "South Korea", flag: "🇰🇷" },
  { code: "DE", dialCode: "+49", name: "Germany", flag: "🇩🇪" },
  { code: "FR", dialCode: "+33", name: "France", flag: "🇫🇷" },
] as const;
