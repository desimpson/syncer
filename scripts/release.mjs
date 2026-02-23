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
  console.log("📁 Checking required files:");
  const results = requiredFiles.map((file) => {
    const { exists } = checkFile(file);
    const status = exists ? "✅" : "❌";
    console.log(`  ${status} ${file}`);
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
  console.log("\n📦 Checking version consistency:");

  if (!packageJson || !manifest) {
    console.log("  ❌ Could not read package.json or manifest.json");
    return { success: false, versionsMatch: false, packageJson, manifest };
  }

  const packageVersion = packageJson.version;
  const manifestVersion = manifest.version;
  const versionsMatch = packageVersion === manifestVersion;

  console.log(`  Package version: ${packageVersion}`);
  console.log(`  Manifest version: ${manifestVersion}`);
  console.log(`  ${versionsMatch ? "✅" : "❌"} Versions match`);

  if (!versionsMatch) {
    console.log("\n❌ Error: Version mismatch detected!");
    console.log("   Run 'npm run version' to sync versions.");
  }

  return { success: versionsMatch, versionsMatch, packageJson, manifest };
};

/**
 * @param {object | undefined} manifest
 */
const validateManifestFields = (manifest) => {
  console.log("\n📋 Checking manifest.json fields:");
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
    console.log("  ❌ Could not read manifest.json");
    return { success: false, allFieldsPresent: false, manifest, fieldResults: [] };
  }

  const fieldResults = requiredManifestFields.map((field) => {
    const exists = manifest[field] !== undefined && manifest[field] !== "";
    const status = exists ? "✅" : "❌";
    console.log(`  ${status} ${field}: ${manifest[field] || "(missing)"}`);
    return { field, exists };
  });

  const allFieldsPresent = fieldResults.every((r) => r.exists);

  if (!allFieldsPresent) {
    console.log("\n❌ Error: Some required manifest fields are missing!");
  }

  return { success: allFieldsPresent, allFieldsPresent, manifest, fieldResults };
};

/**
 * @param {object | undefined} manifest
 */
const printSuccessMessage = (manifest) => {
  console.log("✅ All release checks passed!");
  console.log("\n📝 Next steps:");
  console.log("  1. Create a GitHub release:");
  console.log("     - Go to: https://github.com/YOUR_USERNAME/syncer/releases/new");
  console.log("     - Tag: v" + (manifest?.version || "X.X.X"));
  console.log("     - Title: v" + (manifest?.version || "X.X.X"));
  console.log("     - Attach files: main.js, manifest.json, styles.css");
  console.log("\n  2. Submit to Obsidian Community Plugins:");
  console.log("     - Fork: https://github.com/obsidianmd/obsidian-releases");
  console.log("     - Add entry to community-plugins.json");
  console.log("     - Create a Pull Request");
  console.log("\n  3. See README.md for release instructions");
};

/**
 * @param {object} fileCheck
 * @param {object} versionCheck
 * @param {object} manifestCheck
 */
const printErrorMessage = (fileCheck, versionCheck, manifestCheck) => {
  console.log("❌ Release readiness checks failed!");
  if (!fileCheck.allFilesExist) {
    console.log("\n💡 Build the plugin first:");
    console.log("   export GOOGLE_CLIENT_ID_PROD='your-client-id'");
    console.log("   npm run build:prod");
  }
  if (versionCheck.packageJson && versionCheck.manifest && !versionCheck.versionsMatch) {
    console.log("\n💡 Sync versions:");
    console.log("   npm run version");
  }
  if (manifestCheck.manifest && !manifestCheck.allFieldsPresent) {
    console.log("\n💡 Update manifest.json with all required fields.");
  }
};

console.log("🔍 Checking release readiness...\n");

const packageJson = readJSON("package.json");
const manifest = readJSON("manifest.json");

const fileCheck = validateFiles();
const versionCheck = validateVersions(packageJson, manifest);
const manifestCheck = validateManifestFields(manifest);

const allChecksPassed = [fileCheck, versionCheck, manifestCheck].every((check) => check.success);

console.log("\n" + "=".repeat(50));

if (allChecksPassed) {
  printSuccessMessage(manifest);
  console.log("=".repeat(50));
} else {
  printErrorMessage(fileCheck, versionCheck, manifestCheck);
  console.log("=".repeat(50));

  // Use globalThis.process for ESM compatibility and to avoid 'process is not defined' errors
  globalThis.process?.exit(1);
}
