#!/usr/bin/env node
/**
 * Release helper script for Obsidian Syncer plugin.
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

function checkFile(file) {
  const filePath = path.join(rootDirectory, file);
  const exists = existsSync(filePath);
  return { file, exists, path: filePath };
}

function readJSON(file) {
  try {
    const content = readFileSync(path.join(rootDirectory, file), "utf8");
    return JSON.parse(content);
  } catch {
    return;
  }
}

console.log("🔍 Checking release readiness...\n");

// Check required files
console.log("📁 Checking required files:");
let allFilesExist = true;
for (const file of requiredFiles) {
  const { exists } = checkFile(file);
  const status = exists ? "✅" : "❌";
  console.log(`  ${status} ${file}`);
  if (!exists) {
    allFilesExist = false;
  }
}

// Check version consistency
console.log("\n📦 Checking version consistency:");
const packageJson = readJSON("package.json");
const manifest = readJSON("manifest.json");

if (packageJson && manifest) {
  const packageVersion = packageJson.version;
  const manifestVersion = manifest.version;
  const versionsMatch = packageVersion === manifestVersion;

  console.log(`  Package version: ${packageVersion}`);
  console.log(`  Manifest version: ${manifestVersion}`);
  console.log(`  ${versionsMatch ? "✅" : "❌"} Versions match`);

  if (!versionsMatch) {
    console.log("\n⚠️  Warning: Version mismatch detected!");
    console.log("   Run 'npm run version' to sync versions.");
  }
} else {
  console.log("  ❌ Could not read package.json or manifest.json");
}

// Check manifest.json fields
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

if (manifest) {
  let allFieldsPresent = true;
  for (const field of requiredManifestFields) {
    const exists = manifest[field] !== undefined && manifest[field] !== "";
    const status = exists ? "✅" : "❌";
    console.log(`  ${status} ${field}: ${manifest[field] || "(missing)"}`);
    if (!exists) {
      allFieldsPresent = false;
    }
  }

  if (!allFieldsPresent) {
    console.log("\n⚠️  Warning: Some required manifest fields are missing!");
  }
} else {
  console.log("  ❌ Could not read manifest.json");
}

// Summary
console.log("\n" + "=".repeat(50));
if (allFilesExist) {
  console.log("✅ All required files are present!");
  console.log("\n📝 Next steps:");
  console.log("  1. Create a GitHub release:");
  console.log("     - Go to: https://github.com/YOUR_USERNAME/obsidian-syncer/releases/new");
  console.log("     - Tag: v" + (manifest?.version || "X.X.X"));
  console.log("     - Title: v" + (manifest?.version || "X.X.X"));
  console.log("     - Attach files: main.js, manifest.json, styles.css");
  console.log("\n  2. Submit to Obsidian Community Plugins:");
  console.log("     - Fork: https://github.com/obsidianmd/obsidian-releases");
  console.log("     - Add entry to community-plugins.json");
  console.log("     - Create a Pull Request");
  console.log("\n  3. See README.md for release instructions");
} else {
  console.log("❌ Some required files are missing!");
  console.log("\n💡 Build the plugin first:");
  console.log("   export GOOGLE_CLIENT_ID_PROD='your-client-id'");
  console.log("   npm run build:prod");
  console.log("=".repeat(50));

  // Use globalThis.process to avoid 'process is not defined' errors in some ESM environments
  // Use globalThis.process for ESM compatibility and to avoid 'process is not defined' errors
  globalThis.process?.exit(allFilesExist ? 0 : 1);
}
