import type { App, PluginManifest } from "obsidian";

const getVaultBasePath = (app: App): string | undefined => {
  const adapter = app.vault?.adapter as { getBasePath?: () => string } | undefined;
  if (adapter === undefined || typeof adapter.getBasePath !== "function") {
    return undefined;
  }
  const basePath = adapter.getBasePath();
  return typeof basePath === "string" && basePath.trim().length > 0 ? basePath : undefined;
};

const isAbsolutePath = (filePath: string): boolean =>
  filePath.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(filePath);

const joinPaths = (basePath: string, relativePath: string): string =>
  `${basePath.replace(/[/\\]$/u, "")}/${relativePath.replace(/^[/\\]/u, "")}`;

/**
 * Absolute path to the installed plugin folder (where `main.js` lives).
 *
 * In Obsidian desktop, `__dirname` points at Electron's asar renderer — not the plugin.
 * `manifest.dir` is vault-relative (e.g. `.obsidian/plugins/obsidian-syncer`). Resolve it
 * against the vault base path from the filesystem adapter's `getBasePath()`.
 */
export const resolvePluginDirectory = (app: App, manifest: PluginManifest): string => {
  const manifestDirectory = manifest.dir?.trim() ?? "";
  if (manifestDirectory.length === 0) {
    return "";
  }

  if (isAbsolutePath(manifestDirectory)) {
    return manifestDirectory;
  }

  const vaultBasePath = getVaultBasePath(app);
  if (vaultBasePath === undefined) {
    return manifestDirectory;
  }

  return joinPaths(vaultBasePath, manifestDirectory);
};
