#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientsPath = path.join(rootDirectory, "..", "oauth-clients.prod.json");

const requiredKeys = ["GOOGLE_CLIENT_ID", "MICROSOFT_CLIENT_ID", "TODOIST_CLIENT_ID"];
// GOOGLE_CLIENT_SECRET is optional until staging/prod Desktop JSON lands (#184);
// when present it is an allowed installed-app identifier (public-by-design).
const allowedKeys = new Set([...requiredKeys, "GOOGLE_CLIENT_SECRET"]);
const forbiddenKeyPattern = /private_key|refresh_token|api_key|password/i;
const publicClientForbiddenValuePattern = /^[A-Za-z0-9+/=]{80,}$/;

const raw = readFileSync(clientsPath, "utf8");
const parsed = JSON.parse(raw);

if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
  console.error("oauth-clients.prod.json must be a JSON object.");
  process.exit(1);
}

for (const [key, value] of Object.entries(parsed)) {
  if (!allowedKeys.has(key)) {
    console.error(`Unexpected key in oauth-clients.prod.json: ${key}`);
    process.exit(1);
  }
  if (forbiddenKeyPattern.test(key)) {
    console.error(`Forbidden key shape in oauth-clients.prod.json: ${key}`);
    process.exit(1);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    console.error(`Invalid value for ${key} in oauth-clients.prod.json.`);
    process.exit(1);
  }
  if (key !== "GOOGLE_CLIENT_SECRET" && publicClientForbiddenValuePattern.test(value.trim())) {
    console.error(`Value for ${key} looks secret-shaped; only public client IDs belong here.`);
    process.exit(1);
  }
}

for (const requiredKey of requiredKeys) {
  if (!(requiredKey in parsed)) {
    console.error(`Missing required key in oauth-clients.prod.json: ${requiredKey}`);
    process.exit(1);
  }
}

process.exit(0);
