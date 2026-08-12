#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const mainJsPath = path.join(rootDirectory, "..", "main.js");

const hashFile = (filePath) => createHash("sha256").update(readFileSync(filePath)).digest("hex");

/**
 * Dual-build determinism check. Uses ambient env as-is so local secret overrides remain valid.
 * Release CI does not inject prod client ID secrets — committed oauth-clients.prod.json is the
 * source of truth for published artifacts (matches Observer rebuilds from a clean checkout).
 */
const runProductionBuild = () => {
  const result = spawnSync("npm", ["run", "build:prod"], {
    cwd: path.join(rootDirectory, ".."),
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

try {
  rmSync(mainJsPath, { force: true });
} catch {
  // main.js may not exist yet
}

runProductionBuild();
const firstHash = hashFile(mainJsPath);

try {
  rmSync(mainJsPath, { force: true });
} catch {
  // ignore
}

runProductionBuild();
const secondHash = hashFile(mainJsPath);

if (firstHash !== secondHash) {
  console.error("Production build is not deterministic.");
  console.error(`First hash:  ${firstHash}`);
  console.error(`Second hash: ${secondHash}`);
  process.exit(1);
}
