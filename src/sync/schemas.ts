import { z } from "zod";

/**
 * Schema for the parsed sync metadata embedded inside a Markdown task line.
 */
export const parsedLineSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  title: z.string().optional().default(""),
  link: z.string().min(1),
  heading: z.string().min(1),
});
