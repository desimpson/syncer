#!/usr/bin/env node

import process from "node:process";
import console from "node:console";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  console.error("npm_package_version is not set. Run via npm version, not node directly.");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.join(__dirname, "..");
const manifestPath = path.join(rootDirectory, "manifest.json");
const versionsPath = path.join(rootDirectory, "versions.json");

/**
 * @param {string} filePath
 * @param {unknown} data
 */
const writeJSON = (filePath, data) => {
  writeFileSync(filePath, `${JSON.stringify(data, undefined, "\t")}\n`);
};

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { minAppVersion } = manifest;

  if (!minAppVersion) {
    throw new Error("manifest.json is missing minAppVersion");
  }

  manifest.version = targetVersion;
  writeJSON(manifestPath, manifest);

  const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
  versions[targetVersion] = minAppVersion;
  writeJSON(versionsPath, versions);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
