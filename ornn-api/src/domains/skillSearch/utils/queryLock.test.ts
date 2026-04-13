import { describe, test, expect, beforeEach } from "bun:test";
import { QueryLock } from "./queryLock";

describe("QueryLock", () => {
  let lock: QueryLock;

  beforeEach(() => {
    lock = new QueryLock(500);
  });

  test("acquire_newKey_executesFunction", async () => {
    const result = await lock.acquire("k1", async () => "done");
    expect(result).toBe("done");
  });

  test("acquire_sameKey_deduplicatesConcurrentCalls", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return "result";
    };

    const [r1, r2] = await Promise.all([
      lock.acquire("k1", fn),
      lock.acquire("k1", fn),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe("result");
    expect(r2).toBe("result");
  });

  test("acquire_afterResolve_keyIsReleased", async () => {
    await lock.acquire("k1", async () => "first");
    expect(lock.isLocked("k1")).toBe(false);

    // Can re-acquire
    const result = await lock.acquire("k1", async () => "second");
    expect(result).toBe("second");
  });

  test("acquire_fnThrows_keyIsReleased", async () => {
    await expect(
      lock.acquire("k1", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    expect(lock.isLocked("k1")).toBe(false);
  });

  test("isLocked_duringExecution_returnsTrue", async () => {
    let resolve: () => void;
    const blocker = new Promise<void>((r) => {
      resolve = r;
    });

    const promise = lock.acquire("k1", async () => {
      await blocker;
      return "ok";
    });

    expect(lock.isLocked("k1")).toBe(true);

    resolve!();
    await promise;

    expect(lock.isLocked("k1")).toBe(false);
  });

  test("acquire_timerIsClearedOnResolve_noLeaks", async () => {
    // Use a very short expiry to confirm the timer does not fire after resolution
    const shortLock = new QueryLock(100);

    await shortLock.acquire("k1", async () => "done");

    // Wait longer than expiry - if timer leaked it would delete a re-acquired key
    await new Promise((r) => setTimeout(r, 150));

    // Re-acquire should work cleanly
    let callCount = 0;
    const result = await shortLock.acquire("k1", async () => {
      callCount++;
      return "second";
    });
    expect(result).toBe("second");
    expect(callCount).toBe(1);
  });

  test("acquire_differentKeys_runIndependently", async () => {
    let count = 0;
    const fn = async () => {
      count++;
      return count;
    };

    const [r1, r2] = await Promise.all([
      lock.acquire("a", fn),
      lock.acquire("b", fn),
    ]);

    expect(count).toBe(2);
    expect(r1).not.toBe(r2);
  });
});
