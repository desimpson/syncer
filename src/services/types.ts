import type { z } from "zod";
import type { googleTaskSchema, googleTasksListSchema } from "./schemas";

/** A Google Tasks list entity (id + title). */
export type GoogleTasksList = z.infer<typeof googleTasksListSchema>;

/** A single Google Task item. */
export type GoogleTask = z.infer<typeof googleTaskSchema>;
