import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

// Vitest runs with `import.meta.env.MODE === "test"`, so `IS_DEV` is true
// and the dev branch (console forwarding) is exercised by the static import
// above. The prod branch is covered via a stubbed-env dynamic re-import.

describe("createLogger (dev branch)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards each level to its console method with a tag prefix", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const logger = createLogger("mytag");
    const data = { a: 1 };

    logger.info("info msg", data);
    logger.warn("warn msg", data);
    logger.error("error msg", data);
    logger.debug("debug msg", data);

    expect(log).toHaveBeenCalledWith("[mytag] info msg", data);
    expect(warn).toHaveBeenCalledWith("[mytag] warn msg", data);
    expect(error).toHaveBeenCalledWith("[mytag] error msg", data);
    expect(debug).toHaveBeenCalledWith("[mytag] debug msg", data);
  });

  it("substitutes an empty string when no data is passed", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const logger = createLogger("tag2");
    logger.info("a");
    logger.warn("b");
    logger.error("c");
    logger.debug("d");

    expect(log).toHaveBeenCalledWith("[tag2] a", "");
    expect(warn).toHaveBeenCalledWith("[tag2] b", "");
    expect(error).toHaveBeenCalledWith("[tag2] c", "");
    expect(debug).toHaveBeenCalledWith("[tag2] d", "");
  });
});

describe("createLogger (prod branch)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns no-op methods when MODE is production", async () => {
    vi.stubEnv("MODE", "production");
    vi.resetModules();
    const { createLogger: createProdLogger } = await import("./logger");

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const logger = createProdLogger("prod");
    logger.info("info", { x: 1 });
    logger.warn("warn");
    logger.error("error");
    logger.debug("debug");

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});
