import type { SyncJob } from "@/jobs/types";
import { runtimeClearInterval, runtimeSetInterval } from "@/utils/browser-runtime";
import type { RuntimeIntervalHandle } from "@/utils/browser-runtime";
import { formatLogError } from "@/utils/error-formatters";

/**
 * A scheduler that can run multiple jobs on a fixed interval.
 */
export type Scheduler = {
  start: (intervalMinutes: number) => void;
  stop: () => void;
  restart: (intervalMinutes: number) => void;
};

/**
 * Creates a scheduler for managing sync jobs.
 *
 * Jobs run **sequentially** (not in parallel). Each job read-modify-writes the
 * same sync document via `vault.process`; concurrent runs race and drop creates.
 *
 * @param jobs - An array of jobs to schedule
 * @returns A Scheduler instance with start, stop, and restart methods
 */
export const createScheduler = (jobs: SyncJob[]): Scheduler => {
  let intervalHandle: RuntimeIntervalHandle | undefined = undefined;
  let isRunning = false;
  let hasPendingRun = false;

  const runJobs = async () => {
    if (isRunning) {
      hasPendingRun = true;
      return;
    }
    isRunning = true;
    hasPendingRun = false;
    try {
      for (const job of jobs) {
        try {
          await job.task();
        } catch (error) {
          console.error(`Job [${job.name}] failed: [${formatLogError(error)}].`);
        }
      }
    } finally {
      isRunning = false;
      if (hasPendingRun) {
        void runJobs();
      }
    }
  };

  const start = (intervalMinutes: number) => {
    if (intervalHandle !== undefined) {
      runtimeClearInterval(intervalHandle);
    }
    intervalHandle = runtimeSetInterval(
      () => {
        void runJobs();
      },
      intervalMinutes * 60 * 1000,
    );
    // Run immediately on start
    void runJobs();
  };

  const stop = () => {
    if (intervalHandle !== undefined) {
      runtimeClearInterval(intervalHandle);
      intervalHandle = undefined;
    }
  };

  const restart = (intervalMinutes: number) => {
    stop();
    start(intervalMinutes);
  };

  return { start, stop, restart };
};
