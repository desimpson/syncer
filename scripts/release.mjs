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
import { execFileSync } from "node:child_process";
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
 * Release tags must be annotated: `git push --follow-tags` skips lightweight tags.
 *
 * @param {object | undefined} manifest
 */
const validateAnnotatedTag = (manifest) => {
  console.log("\nChecking release tag annotation:");

  const version = manifest?.version;
  if (typeof version !== "string" || version.length === 0) {
    console.log("  [ERROR] manifest.json version is missing");
    return { success: false, tagPresent: false, annotated: false };
  }

  // Prefer refs/tags/<version>: a detached checkout of the tag target makes
  // `git cat-file -t 0.4.0` resolve to the peeled commit (Actions does this).
  const tagReference = `refs/tags/${version}`;
  let objectType;
  try {
    objectType = execFileSync("git", ["cat-file", "-t", tagReference], {
      cwd: rootDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    try {
      objectType = execFileSync("git", ["cat-file", "-t", version], {
        cwd: rootDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      console.log(`  [SKIP] No local tag "${version}" yet (create with npm version or git tag -a)`);
      return { success: true, tagPresent: false, annotated: false };
    }
  }

  const annotated = objectType === "tag";
  console.log(`  Tag ${tagReference} object type: ${objectType}`);
  console.log(`  [${annotated ? "OK" : "ERROR"}] Tag is annotated`);

  if (!annotated) {
    console.log("\nError: Release tag must be annotated (not lightweight).");
    console.log(`   Fix: git tag -d ${version} && git tag -a ${version} -m "${version}"`);
  }

  return { success: annotated, tagPresent: true, annotated };
};

/**
 * @param {object | undefined} manifest
 */
const printSuccessMessage = (manifest) => {
  console.log("All release checks passed.");
  console.log("\nNext steps:");
  console.log("  1. Ensure the version tag is annotated, then push:");
  console.log("     git push --follow-tags");
  console.log(`     (tag ${manifest?.version || "X.X.X"} must be annotated; see README Releasing)`);
  console.log("\n  2. Confirm the GitHub Actions release attached:");
  console.log("     main.js, manifest.json, styles.css");
  console.log("\n  3. Submit to Obsidian Community Plugins:");
  console.log("     - Go to: https://community.obsidian.md");
  console.log("\n  4. See README.md for full release instructions");
};

/**
 * @param {object} fileCheck
 * @param {object} versionCheck
 * @param {object} versionsJsonCheck
 * @param {object} manifestCheck
 * @param {object} tagCheck
 */
const printErrorMessage = (fileCheck, versionCheck, versionsJsonCheck, manifestCheck, tagCheck) => {
  console.log("Release readiness checks failed.");
  if (!fileCheck.allFilesExist) {
    console.log("\nHint: Build the plugin first:");
    console.log("   export GOOGLE_CLIENT_ID_PROD='your-client-id'");
    console.log("   export MICROSOFT_CLIENT_ID_PROD='your-client-id'");
    console.log("   npm run build:prod");
  }
  if (versionCheck.packageJson && versionCheck.manifest && !versionCheck.versionsMatch) {
    console.log("\nHint: Sync versions:");
    console.log("   npm version patch|minor|major");
  }
  if (versionsJsonCheck.manifest && !versionsJsonCheck.versionsEntryMatch) {
    console.log("\nHint: Sync versions.json:");
    console.log("   npm version patch|minor|major");
  }
  if (manifestCheck.manifest && !manifestCheck.allFieldsPresent) {
    console.log("\nHint: Update manifest.json with all required fields.");
  }
  if (tagCheck.tagPresent && !tagCheck.annotated) {
    const version = versionCheck.manifest?.version ?? "x.y.z";
    console.log("\nHint: Recreate the version tag as annotated:");
    console.log(`   git tag -d ${version}`);
    console.log(`   git tag -a ${version} -m "${version}"`);
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
const tagCheck = validateAnnotatedTag(manifest);

const allChecksPassed = [fileCheck, versionCheck, versionsJsonCheck, manifestCheck, tagCheck].every(
  (check) => check.success,
);

console.log(`\n${"=".repeat(50)}`);

if (allChecksPassed) {
  printSuccessMessage(manifest);
  console.log("=".repeat(50));
} else {
  printErrorMessage(fileCheck, versionCheck, versionsJsonCheck, manifestCheck, tagCheck);
  console.log("=".repeat(50));
  process.exit(1);
}
