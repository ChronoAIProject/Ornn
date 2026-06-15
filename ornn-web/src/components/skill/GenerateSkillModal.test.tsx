/**
 * GenerateSkillModal tests — pins the #1037 security contract.
 *
 * Three independent regressions are locked in here:
 *
 *   1. Bearer scoping. The OpenAPI spec is fetched with a raw
 *      `fetch(openapiRef.value)`. The user's access token may ONLY ride
 *      along when the spec URL's origin matches the configured NyxID
 *      proxy host (the cross-origin host that legitimately needs it).
 *      A spec URL pointing at any other host must get NO Authorization
 *      header — otherwise the token leaks cross-origin.
 *
 *   2. Dead body fields. The generate request once posted
 *      `userToken: accessToken` (the bearer, in a JSON body) and a
 *      `proxyUrl` — both unread by the server. Neither may appear in
 *      the apiPost body.
 *
 *   3. Upload size cap. The markdown-reference upload reads the whole
 *      file into memory via FileReader.readAsText. A >10 MiB `.md`
 *      file must be rejected before that read, with an inline error and
 *      no reference added. Non-`.md` files stay rejected too.
 *
 * @module components/skill/GenerateSkillModal.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";

// vi.mock factories are hoisted above module-scope consts, so the host
// literal is published through vi.hoisted to be reachable from both the
// config factory below and the test bodies.
const { NYXID_HOST, ACCESS_TOKEN } = vi.hoisted(() => ({
  NYXID_HOST: "https://nyx-api.example.com",
  ACCESS_TOKEN: "test-access-token",
}));

vi.mock("@/config", () => ({
  config: {
    apiBaseUrl: "",
    nyxidApiBaseUrl: NYXID_HOST,
    nyxidWebBaseUrl: "https://nyx.example.com",
    nyxidOauthAuthorizeUrl: "",
    nyxidOauthTokenUrl: "",
    nyxidOauthClientId: "",
    nyxidOauthRedirectUri: "",
    nyxidLogoutUrl: "",
    nyxidSettingsUrl: "",
    posthogApiKey: "",
    posthogProjectId: "",
    posthogHost: "",
  },
}));

// apiPost captured so we can assert the generate request body.
const apiPost = vi.fn();
vi.mock("@/services/apiClient", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

// Fixed bearer for the trusted-host assertions (ACCESS_TOKEN hoisted above).
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: { accessToken: string | null }) => unknown) =>
    selector({ accessToken: ACCESS_TOKEN }),
}));

// Echo i18n keys + interpolated opts so assertions can match on the key.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key;
      const parts = Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(" ");
      return `${key} (${parts})`;
    },
  }),
}));

// translateError just surfaces the fallback message in tests.
vi.mock("@/utils/translateError", () => ({
  translateError: (_err: unknown, fallback: string) => fallback,
}));

import { GenerateSkillModal } from "./GenerateSkillModal";

function makeFile(name: string, sizeBytes: number, type = "text/markdown"): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

function setup(openapiSpecUrl: string | null) {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <GenerateSkillModal
      isOpen
      onClose={onClose}
      onSuccess={onSuccess}
      serviceId="svc-1"
      serviceName="Example Service"
      openapiSpecUrl={openapiSpecUrl}
      repositoryUrl={null}
      homepageUrl={null}
    />,
  );
  return { onSuccess, onClose, ...utils };
}

/** Grab the headers object handed to the most recent fetch() call. */
function lastFetchHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const call = fetchMock.mock.calls.at(-1);
  const init = (call?.[1] ?? {}) as RequestInit;
  return (init.headers ?? {}) as Record<string, string>;
}

describe("GenerateSkillModal (#1037)", () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ data: { guid: "g", name: "example-skill", serviceId: "svc-1" }, error: null });
  });

  it("withholds the bearer when the spec host is NOT the NyxID host", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ openapi: "3.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    setup("https://evil.attacker.example.com/api/openapi.json");
    fireEvent.click(screen.getByText("Proceed"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const headers = lastFetchHeaders(fetchMock);
    expect(headers.Authorization).toBeUndefined();

    vi.unstubAllGlobals();
    cleanup();
  });

  it("attaches the bearer when the spec host IS the NyxID host", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ openapi: "3.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    setup(`${NYXID_HOST}/api/v1/proxy/s/example/api/openapi.json`);
    fireEvent.click(screen.getByText("Proceed"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const headers = lastFetchHeaders(fetchMock);
    expect(headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    vi.unstubAllGlobals();
    cleanup();
  });

  it("posts neither userToken nor proxyUrl in the generate body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ openapi: "3.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    setup(`${NYXID_HOST}/api/v1/proxy/s/example/api/openapi.json`);
    fireEvent.click(screen.getByText("Proceed"));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("userToken");
    expect(body).not.toHaveProperty("proxyUrl");
    expect(body).toHaveProperty("references");
    expect(body).toHaveProperty("serviceName", "Example Service");

    vi.unstubAllGlobals();
    cleanup();
  });

  it("rejects an oversize .md upload without adding a reference", async () => {
    setup(null);
    // The Modal renders through createPortal into document.body, so the
    // hidden file input lives outside the render container.
    const fileInput = document.body.querySelector('input[type="file"]') as HTMLInputElement;

    const huge = makeFile("big.md", 11 * 1024 * 1024);
    fireEvent.change(fileInput, { target: { files: [huge] } });

    expect(await screen.findByText(/guided\.fileTooLarge/)).toBeInTheDocument();
    // No markdown chip was added (the filename never renders as a label).
    expect(screen.queryByText("big.md")).not.toBeInTheDocument();
    cleanup();
  });

  it("rejects a non-.md upload", async () => {
    setup(null);
    // The Modal renders through createPortal into document.body, so the
    // hidden file input lives outside the render container.
    const fileInput = document.body.querySelector('input[type="file"]') as HTMLInputElement;

    const wrong = makeFile("notes.txt", 1024, "text/plain");
    fireEvent.change(fileInput, { target: { files: [wrong] } });

    expect(await screen.findByText(/Only \.md/)).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    cleanup();
  });
});
