/**
 * HTTP client for calling ornn-auth service.
 * Used for API key validation (search/MCP endpoints).
 * @module clients/authClient
 */

import { AppError, INTERNAL_AUTH_HEADER } from "ornn-shared";
import type { ApiKeyInfo } from "ornn-shared";

/** Interface for auth operations needed by ornn-api. */
export interface IAuthClient {
  /** Validate an API key and return user info if valid. */
  validateApiKey(key: string): Promise<ApiKeyInfo | null>;
}

/** HTTP client that calls ornn-auth for API key validation. */
export class AuthClient implements IAuthClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  async validateApiKey(key: string): Promise<ApiKeyInfo | null> {
    const res = await fetch(`${this.baseUrl}/api/internal/api-keys/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_AUTH_HEADER]: this.secret,
      },
      body: JSON.stringify({ key }),
    });

    if (!res.ok) {
      if (res.status === 404 || res.status === 401) return null;
      throw AppError.serviceUnavailable("AUTH_SERVICE_ERROR", `Auth service returned ${res.status}`);
    }

    const json = await res.json() as { data: ApiKeyInfo | null };
    return json.data;
  }
}
