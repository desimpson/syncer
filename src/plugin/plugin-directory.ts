import type { App, PluginManifest } from "obsidian";
import { firefoxDebugLog, firefoxDebugWarn } from "@/services/firefox-debug";
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
  const vaultBasePath = getVaultBasePath(app);
  const nodeModules = getDesktopNodeModules();

  firefoxDebugLog("resolvePluginDirectory()", {
    manifestDirectory: manifestDirectory.length > 0 ? manifestDirectory : "(empty)",
    vaultBasePath: vaultBasePath ?? "(unavailable)",
    nodePathAvailable: nodeModules !== undefined,
  });

  if (manifestDirectory.length === 0) {
    firefoxDebugWarn("resolvePluginDirectory: manifest.dir is empty");
    return "";
  }

  const isAbsolute =
    nodeModules?.path.isAbsolute(manifestDirectory) ??
    (manifestDirectory.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(manifestDirectory));

  if (isAbsolute) {
    firefoxDebugLog("resolvePluginDirectory: using absolute manifest.dir", {
      resolved: manifestDirectory,
    });
    return manifestDirectory;
  }

  if (vaultBasePath === undefined) {
    firefoxDebugWarn(
      "resolvePluginDirectory: vault adapter has no getBasePath(); cannot resolve relative manifest.dir",
    );
    return manifestDirectory;
  }

  if (nodeModules !== undefined) {
    const resolved = nodeModules.path.join(vaultBasePath, manifestDirectory);
    firefoxDebugLog("resolvePluginDirectory: resolved against vault base", { resolved });
    return resolved;
  }

  const resolved = `${vaultBasePath.replace(/[/\\]$/u, "")}/${manifestDirectory}`;
  firefoxDebugLog("resolvePluginDirectory: resolved against vault base (string join)", {
    resolved,
  });
  return resolved;
};
