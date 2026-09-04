import { z } from "zod";

const rawBuildConfigSchema = z.object({
  enableGoogle: z.boolean(),
  googleClientId: z.string(),
  googleClientSecret: z.string(),
  microsoftClientId: z.string(),
  todoistClientId: z.string(),
});

export type BuildConfig = {
  enableGoogle: boolean;
  googleClientId: string;
  googleClientSecret: string;
  microsoftClientId: string;
  todoistClientId: string;
};

export const parseBuildConfig = (raw: unknown): BuildConfig => {
  const parsed = rawBuildConfigSchema.parse(raw);

  const googleClientId = parsed.googleClientId.trim();
  const googleClientSecret = parsed.googleClientSecret.trim();
  const microsoftClientId = parsed.microsoftClientId.trim();
  const todoistClientId = parsed.todoistClientId.trim();

  return {
    enableGoogle: parsed.enableGoogle,
    googleClientId: parsed.enableGoogle ? googleClientId : "",
    googleClientSecret: parsed.enableGoogle ? googleClientSecret : "",
    microsoftClientId,
    todoistClientId,
  };
};

const getDefineString = (defineValue: string | undefined): string => {
  return typeof defineValue === "string" ? defineValue : "";
};

const getDefineBoolean = (defineValue: boolean | undefined): boolean => {
  return typeof defineValue === "boolean" ? defineValue : false;
};

export const buildConfig = parseBuildConfig({
  enableGoogle: getDefineBoolean(
    typeof __ENABLE_GOOGLE__ === "boolean" ? __ENABLE_GOOGLE__ : undefined,
  ),
  googleClientId: getDefineString(
    typeof __GOOGLE_CLIENT_ID__ === "string" ? __GOOGLE_CLIENT_ID__ : undefined,
  ),
  googleClientSecret: getDefineString(
    typeof __GOOGLE_CLIENT_SECRET__ === "string" ? __GOOGLE_CLIENT_SECRET__ : undefined,
  ),
  microsoftClientId: getDefineString(
    typeof __MICROSOFT_CLIENT_ID__ === "string" ? __MICROSOFT_CLIENT_ID__ : undefined,
  ),
  todoistClientId: getDefineString(
    typeof __TODOIST_CLIENT_ID__ === "string" ? __TODOIST_CLIENT_ID__ : undefined,
  ),
});
