#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const summaryPath = path.join(rootDirectory, "..", "coverage", "coverage-summary.json");
const outputDirectory = path.join(rootDirectory, "..", "coverage");

const badgeColours = {
  red: "#e05d44",
  yellow: "#dfb317",
  green: "#4c1",
};

function colourForPercent(percent) {
  if (percent < 50) {
    return badgeColours.red;
  }
  if (percent < 80) {
    return badgeColours.yellow;
  }
  return badgeColours.green;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBadge(label, value, colour) {
  const labelWidth = label.length * 7 + 10;
  const valueText = `${Math.round(value)}%`;
  const valueWidth = valueText.length * 7 + 10;
  const totalWidth = labelWidth + valueWidth;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(valueText)}">`,
    `  <title>${escapeXml(label)}: ${escapeXml(valueText)}</title>`,
    `  <linearGradient id="s" x2="0" y2="100%">`,
    `    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>`,
    `    <stop offset="1" stop-opacity=".1"/>`,
    `  </linearGradient>`,
    `  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `  <g clip-path="url(#r)">`,
    `    <rect width="${labelWidth}" height="20" fill="#555"/>`,
    `    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${colour}"/>`,
    `    <rect width="${totalWidth}" height="20" fill="url(#s)"/>`,
    `  </g>`,
    `  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">`,
    `    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>`,
    `    <text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>`,
    `    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(valueText)}</text>`,
    `    <text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(valueText)}</text>`,
    `  </g>`,
    `</svg>`,
    "",
  ].join("\n");
}

function writeBadge(filename, label, percent) {
  const colour = colourForPercent(percent);
  const svg = renderBadge(label, percent, colour);
  writeFileSync(path.join(outputDirectory, filename), svg, "utf8");
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));

writeBadge("coverage-lines.svg", "coverage lines", summary.total.lines.pct);
writeBadge("coverage-branches.svg", "coverage branches", summary.total.branches.pct);
