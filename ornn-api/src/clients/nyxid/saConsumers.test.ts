import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SandboxClient } from "../sandboxClient";
import { NyxLlmClient } from "./llm";
import { NyxLlmCatalogClient } from "./llmCatalog";
import { NyxidOrgsClient } from "./orgs";
import { NyxidServiceClient } from "./service";
import { tokenHarness } from "./saTestHarness";

let h: ReturnType<typeof tokenHarness>;
let allowlist: string | undefined;
beforeEach(() => {
  allowlist = process.env.ORNN_URL_ALLOWLIST_CIDR;
  process.env.ORNN_URL_ALLOWLIST_CIDR = "127.0.0.1";
  h = tokenHarness();
});
afterEach(() => {
  h.close();
  if (allowlist === undefined) delete process.env.ORNN_URL_ALLOWLIST_CIDR;
  else process.env.ORNN_URL_ALLOWLIST_CIDR = allowlist;
});
const params = { model: "test", input: [{ role: "user" as const, content: "hello" }] };
async function collect(events: AsyncIterable<unknown>) {
  const result: unknown[] = [];
  for await (const event of events) result.push(event);
  return result;
}
function clients() {
  const config = { resolver: async () => ({ baseApiUrl: h.base }), saTokenProvider: h.provider };
  return {
    sandbox: new SandboxClient({ resolver: async () => ({ baseUrl: h.base }), saTokenProvider: h.provider }),
    catalog: new NyxLlmCatalogClient(config), orgs: new NyxidOrgsClient(config),
    services: new NyxidServiceClient(config),
    llm: new NyxLlmClient({ resolver: async () => ({ gatewayUrl: h.base, apiKey: "", apiFormat: "responses" }), saTokenProvider: h.provider }),
  };
}

describe("shared-SA consumers (#1265)", () => {
  const operations: [string, (c: ReturnType<typeof clients>) => Promise<unknown>, () => Response][] = [
    ["sandbox execute", (c) => c.sandbox.execute({ script: "1", language: "python" }), () => Response.json({ success: true })],
    ["sandbox session create", (c) => c.sandbox.createSession({ language: "python" }), () => Response.json({ session_id: "test" })],
    ["sandbox session list", (c) => c.sandbox.listSessions(), () => Response.json({ sessions: [] })],
    ["sandbox session delete", (c) => c.sandbox.deleteSession("test"), () => new Response(null, { status: 204 })],
    ["sandbox stream", (c) => collect(c.sandbox.executeStream({ script: "1", language: "python" })), () => new Response('data: {"type":"done"}\n\n')],
    ["LLM catalog", (c) => c.catalog.listUpstreamModels(), () => Response.json({ data: [{ id: "test" }] })],
    ["org members", (c) => c.orgs.listOrgMembers("test"), () => Response.json({ members: [{ user_id: "user", role: "member" }] })],
    ["platform services", async (c) => c.services.listActiveServiceIdsAsPlatform(await h.provider.getAccessToken()), () => Response.json([{ id: "test" }])],
    ["LLM completion", (c) => c.llm.complete(params), () => Response.json({ output: [] })],
    ["LLM stream", (c) => collect(c.llm.stream(params)), () => new Response('data: {"type":"response.completed"}\n\ndata: [DONE]\n\n')],
  ];
  for (const [name, operation, success] of operations) {
    it(`${name} retries exactly once with the shared refreshed token`, async () => {
      const old = await h.provider.getAccessToken();
      let calls = 0;
      h.setDownstream((req) => {
        calls++;
        return req.headers.get("authorization") === `Bearer ${old}` ? new Response(null, { status: 401 }) : success();
      });
      await operation(clients());
      expect(calls).toBe(2);
      expect(h.mintCount).toBe(2);
    });
    it(`${name} preserves its failure contract after the second 401`, async () => {
      let calls = 0;
      const secret = crypto.randomUUID();
      h.setDownstream(() => { calls++; return new Response(secret, { status: 401 }); });
      const result = await Promise.allSettled([operation(clients())]);
      if (name === "org members") expect(result[0]).toEqual({ status: "fulfilled", value: [] });
      else if (name === "platform services") expect(result[0]).toEqual({ status: "fulfilled", value: null });
      else {
        expect(result[0]?.status).toBe("rejected");
        const failed = result[0] as PromiseRejectedResult;
        expect(failed.reason.message).not.toContain(secret);
      }
      expect(calls).toBe(2);
      expect(h.mintCount).toBe(2);
    });
  }

  it.each(["responses", "chat-completion"] as const)("never replaces direct LLM keys (%s) with the SA identity", async (apiFormat) => {
    let calls = 0;
    const direct = crypto.randomUUID();
    h.setDownstream((req) => {
      calls++;
      expect(req.headers.get("authorization")).toBe(`Bearer ${direct}`);
      return new Response(null, { status: 401 });
    });
    const client = new NyxLlmClient({ resolver: async () => ({ gatewayUrl: h.base, apiKey: direct, apiFormat }), saTokenProvider: h.provider });
    await expect(client.complete(params)).rejects.toThrow("401");
    expect(calls).toBe(1);
    expect(h.mintCount).toBe(0);
  });

  it("never retries user-scoped catalog/org calls with a platform identity", async () => {
    let calls = 0;
    h.setDownstream(() => { calls++; return new Response(null, { status: 401 }); });
    const c = clients();
    expect(await c.services.listServicesForCaller("user-token")).toEqual([]);
    await expect(c.orgs.listUserOrgs("user-token")).rejects.toThrow("401");
    expect(calls).toBe(2);
    expect(h.mintCount).toBe(0);
  });
});
