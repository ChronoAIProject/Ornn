/**
 * Model-list mock — controllable in-process Bun HTTP server that the
 * `LlmProvidersService.sync()` flow can be pointed at via its
 * `modelListUrl`. Tests mutate `setNextResponse` to control what the
 * "upstream" returns; one server can be reused across multiple tests
 * to keep startup cheap.
 *
 * @module tests/mocks/modelListServer
 */

export interface ModelListResponse {
  /** Status code returned to the client. Defaults to 200. */
  readonly status?: number;
  /** Body — passed through `JSON.stringify`. */
  readonly body: unknown;
}

export interface ModelListMock {
  /** URL the test should hand to the provider's `modelListUrl`. */
  readonly url: string;
  /** Set the next response. */
  setNextResponse(resp: ModelListResponse): void;
  /** Number of times the endpoint was hit. */
  readonly hitCount: () => number;
  /** Tear down the server. */
  close(): Promise<void>;
}

export async function startModelListServer(): Promise<ModelListMock> {
  let next: ModelListResponse = {
    body: { data: [] },
  };
  let hits = 0;

  const server = Bun.serve({
    port: 0,
    fetch() {
      hits += 1;
      const status = next.status ?? 200;
      return new Response(JSON.stringify(next.body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });

  return {
    url: `http://localhost:${server.port}/v1/models`,
    setNextResponse: (resp) => {
      next = resp;
    },
    hitCount: () => hits,
    close: async () => {
      server.stop(true);
    },
  };
}
