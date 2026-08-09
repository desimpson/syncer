import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "@/sync/scheduler";
import type { SyncJob } from "@/jobs/types";

describe("scheduler", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("queues one pending run when restart is requested mid-run", async () => {
    // Arrange
    let releaseFirstRun: (() => void) | undefined;
    const firstRunPromise = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    const task = vi
      .fn<SyncJob["task"]>()
      .mockImplementationOnce(async () => firstRunPromise)
      .mockImplementation(async () => undefined);
    const scheduler = createScheduler([{ name: "job-a", task }]);

    // Act
    scheduler.start(60);
    scheduler.restart(60);
    releaseFirstRun?.();
    for (let index = 0; index < 10; index += 1) {
      if (task.mock.calls.length >= 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Assert
    expect(task).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
