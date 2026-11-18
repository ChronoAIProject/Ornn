import { NyxidSaTokenProvider } from "./base";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Real HTTP transport, synthetic credentials, and no external services. */
export function tokenHarness() {
  let handle = (_request: Request): Response | Promise<Response> => new Response(null, { status: 404 });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => handle(req) });
  const base = `http://127.0.0.1:${server.port}`;
  let mintCount = 0;
  const tokens: string[] = [];
  const mintBodies: URLSearchParams[] = [];
  let downstream = (_request: Request): Response | Promise<Response> => Response.json({ data: { url: "uploaded" } });
  let mint = (_request: Request): Response | Promise<Response> => {
    const token = crypto.randomUUID();
    tokens.push(token);
    return Response.json({ access_token: token, expires_in: 900 });
  };
  handle = async (req) => {
    if (new URL(req.url).pathname.endsWith("/token")) {
      mintCount++;
      mintBodies.push(new URLSearchParams(await req.clone().text()));
      return mint(req);
    }
    return downstream(req);
  };
  const credentials = { tokenUrl: `${base}/token`, clientId: crypto.randomUUID(), clientSecret: crypto.randomUUID() };
  const provider = new NyxidSaTokenProvider(async () => ({ ...credentials }));
  return {
    base, credentials, provider, tokens, mintBodies,
    get mintCount() { return mintCount; },
    setDownstream(handler: typeof downstream) { downstream = handler; },
    setMint(handler: typeof mint) { mint = handler; },
    close() { server.stop(true); },
  };
}
