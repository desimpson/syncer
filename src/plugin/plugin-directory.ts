import type { App, PluginManifest } from "obsidian";
import { getDesktopNodeModules } from "@/utils/desktop-fs";

const getVaultBasePath = (app: App): string | undefined => {
  const adapter = app.vault?.adapter as { getBasePath?: () => string } | undefined;
  if (adapter === undefined || typeof adapter.getBasePath !== "function") {
    return undefined;
  }
  const basePath = adapter.getBasePath();
  return typeof basePath === "string" && basePath.trim().length > 0 ? basePath : undefined;
};

/**
 * Absolute path to the installed plugin folder (where `main.js` and `sql-wasm.wasm` live).
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

  const nodeModules = getDesktopNodeModules();
  const isAbsolute =
    nodeModules?.path.isAbsolute(manifestDirectory) ??
    (manifestDirectory.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(manifestDirectory));

  if (isAbsolute) {
    return manifestDirectory;
  }

  const vaultBasePath = getVaultBasePath(app);
  if (vaultBasePath === undefined) {
    return manifestDirectory;
  }

  if (nodeModules !== undefined) {
    return nodeModules.path.join(vaultBasePath, manifestDirectory);
  }

  return `${vaultBasePath.replace(/[/\\]$/u, "")}/${manifestDirectory}`;
};
