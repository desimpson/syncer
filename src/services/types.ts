import type { z } from "zod";
import type {
  googleTaskSchema,
  googleTasksListSchema,
  microsoftToDoListSchema,
  microsoftToDoTaskSchema,
  todoistProjectSchema,
  todoistTaskSchema,
} from "./schemas";

/** A Google Tasks list entity (id + title). */
export type GoogleTasksList = z.infer<typeof googleTasksListSchema>;

/** A single Google Task item. */
export type GoogleTask = z.infer<typeof googleTaskSchema>;

/** A Microsoft To Do list entity (id + displayName). */
export type MicrosoftToDoList = z.infer<typeof microsoftToDoListSchema>;

/** A single Microsoft To Do task item. */
export type MicrosoftToDoTask = z.infer<typeof microsoftToDoTaskSchema>;

/** A Todoist project entity (id + name). */
export type TodoistProject = z.infer<typeof todoistProjectSchema>;

/** A single Todoist task item. */
export type TodoistTask = z.infer<typeof todoistTaskSchema>;
