#!/usr/bin/env node

import { existsSync, copyFileSync, mkdirSync, closeSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const colours = {
  dim: "\u001B[2m",
  red: "\u001B[31m",
  yellow: "\u001B[33m",
  reset: "\u001B[0m",
};

const timestamp = () =>
  `${colours.dim}${new Date().toLocaleTimeString("en-AU", { hour12: false })}${colours.reset}`;

const joinArguments = (arguments_) =>
  arguments_.map((value) => (typeof value === "string" ? value : String(value))).join(" ");

const logger = {
  info(...arguments_) {
    console.info(`${timestamp()} [INFO] ${joinArguments(arguments_)}`);
  },
  warn(...arguments_) {
    console.warn(
      `${timestamp()} ${colours.yellow}[WARN]${colours.reset} ${joinArguments(arguments_)}`,
    );
  },
  error(...arguments_) {
    console.error(
      `${timestamp()} ${colours.red}[ERROR]${colours.reset} ${joinArguments(arguments_)}`,
    );
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
    throw new Error(`Source file missing: ${file}. Please run the build before installing.`);
  }
  copyFileSync(source, destination);
  logger.info(`Copied ${file}.`);
};

const copyPlugin = () => {
  logger.info(`Copying plugin to vault: ${vaultPluginDirectory}...`);
  mkdirSync(vaultPluginDirectory, { recursive: true });

  ["main.js", "manifest.json", "styles.css"].map(copyFile);
};

const enableHotReload = () => {
  logger.info("Creating .hotreload file if it doesn't exist...");
  closeSync(openSync(hotReloadFile, "a"));
  logger.info(".hotreload created (Obsidian will reload plugin).");
};

const main = () => {
  if (vaultPluginDirectory === undefined) {
    logger.warn(
      "Environment variable OBSIDIAN_VAULT_PLUGIN_DIR_DEV not set. Skipping local plugin install.",
    );
    process.exit(0);
  }
  try {
    copyPlugin();
    enableHotReload();
    logger.info("Install complete.");
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

main();
