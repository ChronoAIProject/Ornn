/**
 * In-memory deduplication lock for concurrent identical queries.
 * Prevents multiple auto-generation calls for the same query.
 */
export class QueryLock {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly expiryMs: number;

  constructor(expiryMs = 60_000) {
    this.expiryMs = expiryMs;
  }

  /** Returns true if the key is currently locked. */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  /**
   * Acquire a lock for the given key.
   * If already locked, returns the existing promise.
   * Otherwise, runs the provided function and returns its result.
   */
  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.locks.delete(key);
      const timer = this.timers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    });

    this.locks.set(key, promise);

    // Auto-expire as safety net
    const timer = setTimeout(() => {
      this.locks.delete(key);
      this.timers.delete(key);
    }, this.expiryMs);
    this.timers.set(key, timer);

    return promise;
  }
}
