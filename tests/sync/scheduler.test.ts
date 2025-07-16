import { createScheduler } from "@/sync/scheduler";
import { type SyncJob } from "@/integrations/types";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createJob = (name: string, task: () => Promise<void>): SyncJob => ({
  name,
  task,
});

describe("Scheduler", () => {
  let logs: string[] = [];

  const mockConsoleError = vi.spyOn(console, "error").mockImplementation((message) => {
    logs.push(message as string);
  });

  beforeEach(() => {
    logs = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockConsoleError.mockClear();
  });

  it("runs jobs immediately when started", async () => {
    // Arrange
    let ran = false;
    const job = createJob("testJob", async () => {
      ran = true;
    });
    const scheduler = createScheduler([job]);

    // Act
    scheduler.start(1); // 1 minute interval
    vi.runAllTicks();

    // Assert
    expect(ran).toBe(true);
  });

  it("runs jobs on the interval", async () => {
    // Arrange
    let count = 0;
    const job = createJob("intervalJob", async () => {
      count++;
    });
    const scheduler = createScheduler([job]);

    // Act
    scheduler.start(1); // 1 minute interval
    vi.runAllTicks();

    // Assert
    expect(count).toBe(1);

    // Act: Fast-forward 3 minutes
    vi.advanceTimersByTime(3 * 60 * 1000);
    vi.runAllTicks();

    // Assert
    expect(count).toBe(4);
  });

  it("stops the scheduler", async () => {
    // Arrange
    let count = 0;
    const job = createJob("stopJob", async () => {
      count++;
    });
    const scheduler = createScheduler([job]);

    // Act
    scheduler.start(1);
    vi.runAllTicks();

    // Assert
    expect(count).toBe(1);

    // Act: Stop the scheduler and advance time
    scheduler.stop();
    vi.advanceTimersByTime(5 * 60 * 1000);
    vi.runAllTicks();

    // Assert: count should not increase
    expect(count).toBe(1);
  });

  it("restarts the scheduler with a new interval", async () => {
    // Arrange
    let count = 0;
    const job = createJob("restartJob", async () => {
      count++;
    });
    const scheduler = createScheduler([job]);

    // Act
    scheduler.start(1);
    vi.runAllTicks();

    // Assert
    expect(count).toBe(1);

    // Act: Restart with new interval and advance time
    scheduler.restart(2); // 2-minute interval
    vi.advanceTimersByTime(4 * 60 * 1000);
    vi.runAllTicks();

    // Assert
    expect(count).toBe(4);
  });

  it("catches errors in jobs without throwing", async () => {
    // Arrange
    const errorJob: SyncJob = {
      name: "errorJob",
      task: async () => {
        throw new Error("Job failed");
      },
    };
    const scheduler = createScheduler([errorJob]);

    const logs: string[] = [];
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation((message) => logs.push(message as string));

    // Act
    scheduler.start(1); // interval = 1ms
    await vi.advanceTimersByTimeAsync(2);

    // Assert
    expect(logs.some((l) => l.includes("errorJob"))).toBe(true);

    consoleSpy.mockRestore();
    vi.useRealTimers(); // restore real timers
  });
});
