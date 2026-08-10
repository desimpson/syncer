#!/usr/bin/env node
/**
 * Release helper script for Syncer Obsidian plugin.
 *
 * This script helps prepare a release by:
 * 1. Verifying all required files exist
 * 2. Checking that the build is production-ready
 * 3. Providing instructions for creating a GitHub release
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.join(__dirname, "..");

const requiredFiles = ["main.js", "manifest.json", "styles.css"];

/**
 * @param {string} file
 */
function checkFile(file) {
  const filePath = path.join(rootDirectory, file);
  const exists = existsSync(filePath);
  return { file, exists, path: filePath };
}

/**
 * @param {string} file
 */
function readJSON(file) {
  try {
    const content = readFileSync(path.join(rootDirectory, file), "utf8");
    return JSON.parse(content);
  } catch {
    return;
  }
}

const validateFiles = () => {
  console.log("Checking required files:");
  const results = requiredFiles.map((file) => {
    const { exists } = checkFile(file);
    const status = exists ? "OK" : "MISSING";
    console.log(`  [${status}] ${file}`);
    return { file, exists };
  });

  const allFilesExist = results.every((r) => r.exists);
  return { success: allFilesExist, allFilesExist, results };
};

/**
 * @param {object | undefined} packageJson
 * @param {object | undefined} manifest
 */
const validateVersions = (packageJson, manifest) => {
  console.log("\nChecking version consistency:");

  if (!packageJson || !manifest) {
    console.log("  [ERROR] Could not read package.json or manifest.json");
    return { success: false, versionsMatch: false, packageJson, manifest };
  }

  const packageVersion = packageJson.version;
  const manifestVersion = manifest.version;
  const versionsMatch = packageVersion === manifestVersion;

  console.log(`  Package version: ${packageVersion}`);
  console.log(`  Manifest version: ${manifestVersion}`);
  console.log(`  [${versionsMatch ? "OK" : "MISMATCH"}] Versions match`);

  if (!versionsMatch) {
    console.log("\nError: Version mismatch detected!");
    console.log("   Run 'npm run version' to sync versions.");
  }

  return { success: versionsMatch, versionsMatch, packageJson, manifest };
};

/**
 * @param {object | undefined} manifest
 * @param {Record<string, string> | undefined} versionsJson
 */
const validateVersionsJson = (manifest, versionsJson) => {
  console.log("\nChecking versions.json:");

  if (!manifest || !versionsJson) {
    console.log("  [ERROR] Could not read manifest.json or versions.json");
    return { success: false, versionsEntryMatch: false, manifest, versionsJson };
  }

  const expectedMinAppVersion = manifest.minAppVersion;
  const actualMinAppVersion = versionsJson[manifest.version];
  const versionsEntryMatch = actualMinAppVersion === expectedMinAppVersion;

  console.log(`  versions.json["${manifest.version}"]: ${actualMinAppVersion ?? "(missing)"}`);
  console.log(`  manifest minAppVersion: ${expectedMinAppVersion}`);
  console.log(`  [${versionsEntryMatch ? "OK" : "MISMATCH"}] versions.json entry matches`);

  if (!versionsEntryMatch) {
    console.log("\nError: versions.json is out of sync!");
    console.log("   Run 'npm run version' to sync versions.");
  }

  return { success: versionsEntryMatch, versionsEntryMatch, manifest, versionsJson };
};

/**
 * @param {object | undefined} manifest
 */
const validateManifestFields = (manifest) => {
  console.log("\nChecking manifest.json fields:");
  const requiredManifestFields = [
    "id",
    "name",
    "version",
    "minAppVersion",
    "description",
    "author",
    "authorUrl",
  ];

  if (!manifest) {
    console.log("  [ERROR] Could not read manifest.json");
    return { success: false, allFieldsPresent: false, manifest, fieldResults: [] };
  }

  const fieldResults = requiredManifestFields.map((field) => {
    const exists = manifest[field] !== undefined && manifest[field] !== "";
    const status = exists ? "OK" : "MISSING";
    console.log(`  [${status}] ${field}: ${manifest[field] || "(missing)"}`);
    return { field, exists };
  });

  const allFieldsPresent = fieldResults.every((r) => r.exists);

  if (!allFieldsPresent) {
    console.log("\nError: Some required manifest fields are missing!");
  }

  return { success: allFieldsPresent, allFieldsPresent, manifest, fieldResults };
};

/**
 * @param {object | undefined} manifest
 */
const printSuccessMessage = (manifest) => {
  console.log("All release checks passed.");
  console.log("\nNext steps:");
  console.log("  1. Create a GitHub release:");
  console.log("     - Go to: https://github.com/desimpson/syncer/releases/new");
  console.log(`     - Tag: ${manifest?.version || "X.X.X"}`);
  console.log(`     - Title: ${manifest?.version || "X.X.X"}`);
  console.log("     - Attach files: main.js, manifest.json, styles.css");
  console.log("\n  2. Submit to Obsidian Community Plugins:");
  console.log("     - Go to: https://community.obsidian.md");
  console.log("     - Link your GitHub account");
  console.log("     - Add your plugin from the community dashboard");
  console.log("\n  3. See README.md for release instructions");
};

/**
 * @param {object} fileCheck
 * @param {object} versionCheck
 * @param {object} versionsJsonCheck
 * @param {object} manifestCheck
 */
const printErrorMessage = (fileCheck, versionCheck, versionsJsonCheck, manifestCheck) => {
  console.log("Release readiness checks failed.");
  if (!fileCheck.allFilesExist) {
    console.log("\nHint: Build the plugin first:");
    console.log("   export GOOGLE_CLIENT_ID_PROD='your-client-id'");
    console.log("   export MICROSOFT_CLIENT_ID_PROD='your-client-id'");
    console.log("   npm run build:prod");
  }
  if (versionCheck.packageJson && versionCheck.manifest && !versionCheck.versionsMatch) {
    console.log("\nHint: Sync versions:");
    console.log("   npm run version");
  }
  if (versionsJsonCheck.manifest && !versionsJsonCheck.versionsEntryMatch) {
    console.log("\nHint: Sync versions.json:");
    console.log("   npm run version");
  }
  if (manifestCheck.manifest && !manifestCheck.allFieldsPresent) {
    console.log("\nHint: Update manifest.json with all required fields.");
  }
};

console.log("Checking release readiness...\n");

const packageJson = readJSON("package.json");
const manifest = readJSON("manifest.json");
const versionsJson = readJSON("versions.json");

const fileCheck = validateFiles();
const versionCheck = validateVersions(packageJson, manifest);
const versionsJsonCheck = validateVersionsJson(manifest, versionsJson);
const manifestCheck = validateManifestFields(manifest);

const allChecksPassed = [fileCheck, versionCheck, versionsJsonCheck, manifestCheck].every(
  (check) => check.success,
);

console.log(`\n${"=".repeat(50)}`);

if (allChecksPassed) {
  printSuccessMessage(manifest);
  console.log("=".repeat(50));
} else {
  printErrorMessage(fileCheck, versionCheck, versionsJsonCheck, manifestCheck);
  console.log("=".repeat(50));
  process.exit(1);
}
