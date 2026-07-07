/**
 * useSkillPackage — guards the proxied download call (#1196).
 *
 * The hook fetches a skill version's ZIP through ornn-api's authenticated
 * download route. The path MUST carry the `/api/v1` prefix like every other
 * apiClient call — a missing prefix silently 404s at the NyxID proxy (the bug
 * that shipped in the first cut, invisible because component tests mock this
 * hook wholesale).
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGetBinary = vi.fn();
vi.mock("@/services/apiClient", () => ({
  apiGetBinary: (...a: unknown[]) => apiGetBinary(...a),
  ApiClientError: class ApiClientError extends Error {
    statusCode = 0;
  },
}));

const loadAsync = vi.fn();
vi.mock("jszip", () => ({
  default: { loadAsync: (...a: unknown[]) => loadAsync(...a) },
}));

import { useSkillPackage } from "./useSkillPackage";

describe("useSkillPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetBinary.mockResolvedValue(new ArrayBuffer(8));
    // Minimal JSZip stub: an empty archive (forEach yields nothing).
    loadAsync.mockResolvedValue({ forEach: () => {} });
  });

  it("downloads via the /api/v1 proxied route using guid + version", async () => {
    renderHook(() => useSkillPackage("guid-123", "1.2"));
    await waitFor(() =>
      expect(apiGetBinary).toHaveBeenCalledWith(
        "/api/v1/skills/guid-123/versions/1.2/download",
      ),
    );
  });

  it("encodes guid/version and never omits the /api/v1 prefix", async () => {
    renderHook(() => useSkillPackage("a/b", "latest"));
    await waitFor(() =>
      expect(apiGetBinary).toHaveBeenCalledWith(
        "/api/v1/skills/a%2Fb/versions/latest/download",
      ),
    );
  });

  it("does not fetch until both guid and version are present", () => {
    renderHook(() => useSkillPackage(undefined, "1.2"));
    renderHook(() => useSkillPackage("guid-123", undefined));
    expect(apiGetBinary).not.toHaveBeenCalled();
  });
});
