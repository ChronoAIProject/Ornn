import { createLogger } from "../../shared/logger";

const logger = createLogger("saRequest");

export interface SaTokenSource {
  getAccessToken(): Promise<string>;
  invalidate(rejectedToken: string): void;
}

/**
 * Only an explicit rejection permits replay. Callers must recreate the
 * request (including its settings-derived URL and replayable body) each time.
 * Streaming callers use this before handing any response bytes to consumers.
 */
export async function requestWithSaToken(
  source: SaTokenSource,
  send: (token: string) => Promise<Response>,
): Promise<Response> {
  let token = await source.getAccessToken();
  const first = await send(token);
  if (first.status !== 401) return first;
  source.invalidate(token);
  await first.body?.cancel();
  logger.info("Retrying rejected service-account request once");
  token = await source.getAccessToken();
  const second = await send(token);
  if (second.status === 401) source.invalidate(token);
  return second;
}
