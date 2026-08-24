#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

const committedFiles = ["oauth-clients.staging.json", "oauth-clients.prod.json"];

const requiredKeys = ["GOOGLE_CLIENT_ID", "MICROSOFT_CLIENT_ID", "TODOIST_CLIENT_ID"];
const allowedKeys = new Set([...requiredKeys, "GOOGLE_CLIENT_SECRET"]);
const forbiddenKeyPattern = /private_key|refresh_token|api_key|password/i;
const publicClientForbiddenValuePattern = /^[A-Za-z0-9+/=]{80,}$/;

/**
 * @param {string} fileName
 * @param {unknown} parsed
 */
const validateCommittedOAuthClients = (fileName, parsed) => {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(`${fileName} must be a JSON object.`);
    process.exit(1);
  }

  /** @type {Record<string, unknown>} */
  const record = parsed;

  for (const [key, value] of Object.entries(record)) {
    if (!allowedKeys.has(key)) {
      console.error(`Unexpected key in ${fileName}: ${key}`);
      process.exit(1);
    }
    if (forbiddenKeyPattern.test(key)) {
      console.error(`Forbidden key shape in ${fileName}: ${key}`);
      process.exit(1);
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      console.error(`Invalid value for ${key} in ${fileName}.`);
      process.exit(1);
    }
    if (key !== "GOOGLE_CLIENT_SECRET" && publicClientForbiddenValuePattern.test(value.trim())) {
      console.error(`Value for ${key} looks secret-shaped; only public client IDs belong here.`);
      process.exit(1);
    }
  }

  for (const requiredKey of requiredKeys) {
    if (!(requiredKey in record)) {
      console.error(`Missing required key in ${fileName}: ${requiredKey}`);
      process.exit(1);
    }
  }
};

for (const fileName of committedFiles) {
  const clientsPath = path.join(rootDirectory, "..", fileName);
  const raw = readFileSync(clientsPath, "utf8");
  validateCommittedOAuthClients(fileName, JSON.parse(raw));
}

process.exit(0);
