import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const targetVersion = process.env.npm_package_version;
// read minAppVersion from manifest.json and bump version to target version
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(rootDirectory, "manifest.json");
let manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { minAppVersion } = manifest;

manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, undefined, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
const versionsPath = path.join(rootDirectory, "versions.json");
let versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, undefined, "\t"));
