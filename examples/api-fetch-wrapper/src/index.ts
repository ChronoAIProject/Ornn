/**
 * api-fetch-wrapper example skill.
 *
 * Reads `{ latitude, longitude }` from stdin, fetches the current
 * conditions from Open-Meteo, writes `{ temperatureC, windSpeedKmh,
 * fetchedAt }` to stdout. One retry on transient network failure.
 *
 * Demonstrates the four production-shaped patterns every "skill that
 * calls an external service" needs:
 *
 *   1. Secrets via env (none here — Open-Meteo is keyless — but the
 *      reading pattern is shown via OPEN_METEO_URL).
 *   2. Retry policy: one bounded retry on transient failure, no
 *      exponential blow-up.
 *   3. Error normalisation: stderr always carries a structured
 *      `{ error, cause }` blob, never the raw upstream body.
 *   4. No-leak on failure: the raw upstream response is never logged.
 */

const OPEN_METEO_URL = process.env.OPEN_METEO_URL ?? "https://api.open-meteo.com";
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

interface Input {
  latitude: number;
  longitude: number;
}

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; wind_speed_10m?: number };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function isTransient(status: number): boolean {
  // 408 timeout, 429 throttling, 5xx server side — all worth one retry.
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

async function fetchWeather(input: Input): Promise<OpenMeteoResponse> {
  const url = new URL("/v1/forecast", OPEN_METEO_URL);
  url.searchParams.set("latitude", String(input.latitude));
  url.searchParams.set("longitude", String(input.longitude));
  url.searchParams.set("current", "temperature_2m,wind_speed_10m");

  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error("network failure after retry", { cause: err });
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    if (res.ok) {
      return (await res.json()) as OpenMeteoResponse;
    }

    lastStatus = res.status;
    if (!isTransient(res.status) || attempt === MAX_ATTEMPTS) {
      // Drain the body so the socket can be reused, but DO NOT include
      // it in the thrown error — upstream APIs sometimes echo secrets.
      await res.text().catch(() => undefined);
      throw new Error(`upstream returned ${res.status}`);
    }
    await res.text().catch(() => undefined);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  throw new Error(`upstream returned ${lastStatus}`);
}

async function main(): Promise<void> {
  const raw = (await readStdin()).trim();
  if (!raw) throw new Error("expected JSON `{ latitude, longitude }` on stdin");
  const input = JSON.parse(raw) as Input;
  if (typeof input.latitude !== "number" || typeof input.longitude !== "number") {
    throw new Error("`latitude` and `longitude` must be numbers");
  }

  const upstream = await fetchWeather(input);
  const current = upstream.current ?? {};

  process.stdout.write(
    JSON.stringify({
      temperatureC: current.temperature_2m ?? null,
      windSpeedKmh: current.wind_speed_10m ?? null,
      fetchedAt: new Date().toISOString(),
    }) + "\n",
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
  process.stderr.write(JSON.stringify({ error: message, cause }) + "\n");
  process.exit(1);
});
