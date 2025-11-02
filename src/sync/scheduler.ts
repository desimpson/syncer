import type { SyncJob } from "@/jobs/types";
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
 * @param jobs - An array of jobs to schedule
 * @returns A Scheduler instance with start, stop, and restart methods
 */
export const createScheduler = (jobs: SyncJob[]): Scheduler => {
  let intervalHandle: NodeJS.Timeout | undefined = undefined;

  const runJobs = async () =>
    Promise.all(
      jobs.map((job) =>
        job.task().catch((error) => {
          console.error(`Job [${job.name}] failed: [${formatLogError(error)}].`);
        }),
      ),
    );

  const start = (intervalMinutes: number) => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
    }
    intervalHandle = setInterval(runJobs, intervalMinutes * 60 * 1000);
    // Run immediately on start
    void runJobs();
  };

  const stop = () => {
    if (intervalHandle !== undefined) {
      clearInterval(intervalHandle);
      intervalHandle = undefined;
    }
  };

  const restart = (intervalMinutes: number) => {
    stop();
    start(intervalMinutes);
  };

  return { start, stop, restart };
};
