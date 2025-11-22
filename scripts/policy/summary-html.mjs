#!/usr/bin/env node
/**
 * BrikByte Studios — Governance Summary HTML Wrapper (Optional, PIPE-GOV-8.2)
 *
 * Responsibilities:
 *  - Read out/summary.md (Markdown) produced by summary.mjs.
 *  - Wrap it in a minimal HTML shell so CI can upload out/summary.html
 *    as an artifact for offline viewing.
 *
 * This is intentionally simple and does NOT attempt a full Markdown→HTML
 * conversion (no external dependencies).
 *
 * Usage:
 *   node scripts/policy/summary-html.mjs \
 *     --markdown out/summary.md \
 *     --out out/summary.html
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/**
 * Basic HTML escape for embedding plaintext/Markdown in <pre>.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function main() {
  const args = parseArgs(process.argv);
  const mdPath = args.markdown || "out/summary.md";
  const outPath = args.out || "out/summary.html";

  if (!fs.existsSync(mdPath)) {
    throw new Error(
      `Markdown summary not found at "${mdPath}". Run summary.mjs first.`
    );
  }

  const md = fs.readFileSync(mdPath, "utf8");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Governance Summary (policy-gate)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #e5e7eb;
      padding: 1.5rem;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      background: #020617;
      border-radius: 0.75rem;
      padding: 1.25rem;
      border: 1px solid #1f2937;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <h1>Governance Summary (policy-gate)</h1>
  <pre>${escapeHtml(md)}</pre>
</body>
</html>
`;

  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outPath, html, "utf8");

  console.log(`summary-html: wrote HTML summary to "${outPath}".`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(
      `summary-html: unexpected error while generating HTML summary: ${err.message}`
    );
    process.exit(1);
  });
}
