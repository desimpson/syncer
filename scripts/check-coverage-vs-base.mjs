#!/usr/bin/env node
import { readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prefix = "Coverage vs main:";
const baselineUrl =
  "https://raw.githubusercontent.com/desimpson/syncer/badges/coverage-summary.json";
const fetchTimeoutMs = 15_000;

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const summaryPath = path.join(rootDirectory, "..", "coverage", "coverage-summary.json");

function readLocalSummary() {
  const raw = readFileSync(summaryPath, "utf8");
  return JSON.parse(raw);
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function readPercent(summary, metric) {
  const value = summary?.total?.[metric]?.pct;
  if (!Number.isFinite(value)) {
    console.error(`${prefix} ${metric}: missing or invalid percent in summary.`);
    process.exit(1);
  }
  return value;
}

function fetchBaseline() {
  return new Promise((resolve, reject) => {
    const request = https.get(baselineUrl, (response) => {
      if (response.statusCode === 404) {
        console.error(
          `${prefix} baseline not found at ${baselineUrl} — skipping (first main publish).`,
        );
        process.exit(0);
      }
      if (
        response.statusCode === undefined ||
        response.statusCode < 200 ||
        response.statusCode >= 300
      ) {
        console.error(
          `${prefix} failed to fetch baseline (${response.statusCode ?? "unknown"} ${response.statusMessage ?? ""}).`,
        );
        process.exit(1);
      }

      const chunks = [];
      response.on("data", (chunk) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        request.setTimeout(0);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(fetchTimeoutMs, () => {
      request.destroy();
      reject(new Error("timeout"));
    });
    request.on("error", (error) => {
      reject(error);
    });
  });
}

function compareCoverage(local, baseline) {
  const metrics = ["lines", "branches"];
  let failed = false;

  for (const metric of metrics) {
    const currentPct = readPercent(local, metric);
    const baselinePct = readPercent(baseline, metric);
    console.error(
      `${prefix} ${metric}: current ${formatPercent(currentPct)}, baseline ${formatPercent(baselinePct)}`,
    );
    if (currentPct < baselinePct) {
      console.error(
        `${prefix} ${metric} regressed (${formatPercent(currentPct)} < ${formatPercent(baselinePct)}).`,
      );
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.error(`${prefix} OK — no regression vs main baseline.`);
}

try {
  const local = readLocalSummary();
  const baseline = await fetchBaseline();
  compareCoverage(local, baseline);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "timeout") {
    console.error(`${prefix} failed to fetch baseline (timeout).`);
  } else {
    console.error(`${prefix} unexpected error:`, error);
  }
  process.exit(1);
}
