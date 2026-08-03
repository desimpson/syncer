declare const __dirname: string;

import { firefoxDebugLog } from "@/services/firefox-debug";

/**
 * Absolute path to the folder containing `main.js`.
 * Prefer this over `manifest.dir`, which is not always populated in Obsidian.
 */
export const getPluginDirectory = (): string => {
  firefoxDebugLog("getPluginDirectory()", { __dirname, typeofDirname: typeof __dirname });
  return __dirname;
};
