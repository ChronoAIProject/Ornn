import { expect, it } from "bun:test";

it("omits credentials and authentication response bodies from logs and errors", () => {
  const canary = crypto.randomUUID();
  // A fresh process captures the real Pino destination without replacing loggers.
  const script = `
    import { NyxidSaTokenProvider } from "./base";
    import { StorageClient } from "../storageClient";
    import { SandboxClient } from "../sandboxClient";
    import { NyxLlmClient } from "./llm";
    import { NyxLlmCatalogClient } from "./llmCatalog";
    import { NyxidOrgsClient } from "./orgs";
    import { NyxidServiceClient } from "./service";
    const secret = process.env.TEST_CANARY;
    let rejectMint = false;
    globalThis.fetch = async (url) => String(url).endsWith("/token") && !rejectMint
      ? Response.json({ access_token: secret })
      : new Response(secret, { status: 401 });
    const provider = new NyxidSaTokenProvider(async () => ({
      tokenUrl: "http://127.0.0.1/token", clientId: secret, clientSecret: secret,
    }));
    const config = { resolver: async () => ({ baseApiUrl: "http://127.0.0.1" }), saTokenProvider: provider };
    const service = new NyxidServiceClient(config);
    const actions = [
      () => new StorageClient({ resolver: async () => ({ baseUrl: "http://127.0.0.1", bucket: "test" }), saTokenProvider: provider }).upload("test", "key", new Uint8Array([0]), "application/zip"),
      () => new SandboxClient({ resolver: async () => ({ baseUrl: "http://127.0.0.1" }), saTokenProvider: provider }).listSessions(),
      () => new NyxLlmClient({ resolver: async () => ({ gatewayUrl: "http://127.0.0.1", apiKey: "", apiFormat: "responses" }), saTokenProvider: provider }).complete({ model: "test", input: [] }),
      () => new NyxLlmCatalogClient(config).listUpstreamModels(),
      () => new NyxidOrgsClient(config).listOrgMembers("test"),
      async () => service.listActiveServiceIdsAsPlatform(await provider.getAccessToken()),
      async () => { rejectMint = true; provider.invalidate(); await provider.getAccessToken(); },
    ];
    for (const action of actions) {
      try { await action(); } catch (err) { console.error(err.message); }
    }
    console.log("completed secret handling checks");
  `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: import.meta.dir,
    env: { PATH: process.env.PATH, TEST_CANARY: canary, ORNN_URL_ALLOWLIST_CIDR: "127.0.0.1", LOG_LEVEL: "debug" },
    stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  expect(output).toContain("completed secret handling checks");
  expect(output).toContain("401");
  expect(output).not.toContain(canary);
});
