#!/usr/bin/env node

import { existsSync, copyFileSync, mkdirSync, closeSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const colours = {
  blue: "\u001B[1;34m",
  red: "\u001B[1;31m",
  yellow: "\u001B[1;33m",
  reset: "\u001B[0m",
};

const logger = {
  _timePrefix: () => `[${new Date().toLocaleTimeString("en-AU", { hour12: false })}]`,
  info(...arguments_) {
    console.info(this._timePrefix(), colours.blue, ...arguments_, colours.reset);
  },
  error(...arguments_) {
    console.error(this._timePrefix(), colours.red, ...arguments_, colours.reset);
  },
  warn(...arguments_) {
    console.warn(this._timePrefix(), colours.yellow, ...arguments_, colours.reset);
  },
};

const __dirname = path.resolve(fileURLToPath(import.meta.url), "..");

const pluginDirectory = path.resolve(__dirname, "..");

const vaultPluginDirectory = process.env.OBSIDIAN_VAULT_PLUGIN_DIR_DEV
  ? path.resolve(process.env.OBSIDIAN_VAULT_PLUGIN_DIR_DEV)
  : undefined;

const hotReloadFile = vaultPluginDirectory
  ? path.join(vaultPluginDirectory, ".hotreload")
  : undefined;

const copyFile = (file) => {
  const source = path.join(pluginDirectory, file);
  const destination = path.join(vaultPluginDirectory, file);
  if (!existsSync(source)) {
    throw new Error(`⚠️ Source file missing: ${file}. Please run the build before installing.`);
  }
  copyFileSync(source, destination);
  logger.info(`  📄 Copied ${file}.`);
};

const copyPlugin = () => {
  logger.info(`🚀 Copying plugin to vault: ${vaultPluginDirectory}...`);
  mkdirSync(vaultPluginDirectory, { recursive: true });

  // eslint-disable-next-line unicorn/no-array-callback-reference
  ["main.js", "manifest.json", "styles.css"].map(copyFile);
};

const enableHotReload = () => {
  logger.info("🔁 Creating .hotreload file if it doesn't exist...");
  closeSync(openSync(hotReloadFile, "a"));
  logger.info("  ✅ .hotreload created (Obsidian will reload plugin).");
};

const main = () => {
  if (vaultPluginDirectory === undefined) {
    logger.warn(
      "⚠️  Environment variable OBSIDIAN_VAULT_PLUGIN_DIR_DEV not set. Skipping local plugin install.",
    );
    process.exit(0);
  }
  try {
    copyPlugin();
    enableHotReload();
    logger.info("✅ Install complete.");
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
};

main();
