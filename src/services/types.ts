import type { z } from "zod";
import type {
  googleTaskSchema,
  googleTasksListSchema,
  microsoftToDoListSchema,
  microsoftToDoTaskSchema,
} from "./schemas";

/** A Google Tasks list entity (id + title). */
export type GoogleTasksList = z.infer<typeof googleTasksListSchema>;

/** A single Google Task item. */
export type GoogleTask = z.infer<typeof googleTaskSchema>;

/** A Microsoft To Do list entity (id + displayName). */
export type MicrosoftToDoList = z.infer<typeof microsoftToDoListSchema>;

/** A single Microsoft To Do task item. */
export type MicrosoftToDoTask = z.infer<typeof microsoftToDoTaskSchema>;
