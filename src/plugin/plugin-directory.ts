declare const __dirname: string;

/**
 * Absolute path to the folder containing `main.js`.
 * Prefer this over `manifest.dir`, which is not always populated in Obsidian.
 */
export const getPluginDirectory = (): string => __dirname;
