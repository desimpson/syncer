/**
 * Tracks whether any of N concurrent async operations are still running.
 *
 * Each call to {@link run} increments an internal counter on entry and
 * decrements it in a `finally` block, so {@link isActive} only returns
 * `false` once every concurrent operation has completed — even when
 * multiple jobs run in parallel via `Promise.all`.
 */
export class SyncGuard {
  private count = 0;

  /** `true` while at least one guarded operation is in progress. */
  public get isActive(): boolean {
    return this.count > 0;
  }

  /**
   * Execute `fn` inside the guard.
   *
   * @returns The value returned by `fn`.
   */
  public async run<T>(function_: () => Promise<T>): Promise<T> {
    this.count++;
    try {
      return await function_();
    } finally {
      this.count--;
    }
  }
}
