#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const mainJsPath = path.join(rootDirectory, "..", "main.js");

const hashFile = (filePath) => createHash("sha256").update(readFileSync(filePath)).digest("hex");

const runProductionBuild = () => {
  const result = spawnSync("npm", ["run", "build:prod"], {
    cwd: path.join(rootDirectory, ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      GOOGLE_CLIENT_ID_PROD: "",
      MICROSOFT_CLIENT_ID_PROD: "",
    },
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
