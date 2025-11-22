#!/usr/bin/env node
/**
 * BrikByte Studios — Governance Summary PR Comment Helper (PIPE-GOV-8.2)
 *
 * Responsibilities:
 *  - Read a Markdown file (e.g. out/summary.md) produced by summary.mjs.
 *  - Detect current GitHub Actions context:
 *      - GITHUB_EVENT_NAME == "pull_request"
 *      - GITHUB_EVENT_PATH with pull_request payload
 *      - GITHUB_REPOSITORY (owner/repo)
 *      - GITHUB_TOKEN for API calls
 *  - Create or update a single sticky PR comment whose body starts with:
 *      "## Governance Summary (policy-gate)"
 *
 * Behavior:
 *  - If no existing comment with that marker exists → create a new one.
 *  - If one exists → update it in-place (no noisy duplicates).
 *
 * Usage in CI:
 *   - name: Post PR summary
 *     if: always() && github.event_name == 'pull_request'
 *     run: node scripts/policy/comment.mjs out/summary.md
 */

import fs from "node:fs";

/**
 * Tiny helper to read the GitHub event payload.
 *
 * Expects GITHUB_EVENT_PATH to point at JSON created by Actions.
 */
function loadGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error(
      "GITHUB_EVENT_PATH is missing or does not exist. Are you running inside GitHub Actions?"
    );
  }
  const raw = fs.readFileSync(eventPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Minimal REST client using Node's global fetch (Node 18+ / 20+).
 *
 * We keep this tiny to avoid adding external dependencies.
 */
async function ghRequest(method, url, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Export it from the workflow (with permissions: contents: write)."
    );
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: payload,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `GitHub API ${method} ${url} failed: ${resp.status} ${resp.statusText} — ${text}`
    );
  }
  return resp.json();
}

/**
 * Find an existing governance summary comment on the PR, if any.
 *
 * A comment is considered a match if its body starts with
 * "## Governance Summary (policy-gate)".
 */
async function findExistingSummaryComment(owner, repo, issueNumber) {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  const comments = await ghRequest("GET", baseUrl);

  const marker = "## Governance Summary (policy-gate)";
  for (const c of comments) {
    if (typeof c.body === "string" && c.body.startsWith(marker)) {
      return c;
    }
  }
  return null;
}

/**
 * Create a new governance summary comment on the PR.
 */
async function createSummaryComment(owner, repo, issueNumber, body) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  return ghRequest("POST", url, { body });
}

/**
 * Update an existing governance summary comment in-place.
 */
async function updateSummaryComment(owner, repo, commentId, body) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`;
  return ghRequest("PATCH", url, { body });
}

/**
 * Main entrypoint:
 *  - Reads summary Markdown from the first CLI argument (path).
 *  - No-op if not running in a pull_request context.
 */
async function main() {
  const [_, __, summaryPath] = process.argv;

  if (!summaryPath) {
    throw new Error(
      "Usage: node scripts/policy/comment.mjs <summary.md>. You must provide the path to the Markdown summary."
    );
  }

  if (!fs.existsSync(summaryPath)) {
    throw new Error(
      `Summary file "${summaryPath}" does not exist. Ensure summary.mjs has run successfully.`
    );
  }

  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request") {
    console.log(
      `comment.mjs: Not a pull_request event (${eventName}); skipping PR comment creation.`
    );
    return;
  }

  const repoSlug = process.env.GITHUB_REPOSITORY;
  if (!repoSlug || !repoSlug.includes("/")) {
    throw new Error(
      `GITHUB_REPOSITORY is invalid ("${repoSlug}"). Expected "owner/repo".`
    );
  }
  const [owner, repo] = repoSlug.split("/");

  const event = loadGithubEvent();
  if (!event.pull_request || !event.pull_request.number) {
    throw new Error(
      "GitHub event payload does not contain pull_request.number. Cannot determine PR to comment on."
    );
  }
  const prNumber = event.pull_request.number;

  const summaryBody = fs.readFileSync(summaryPath, "utf8");

  console.log(
    `comment.mjs: Posting governance summary to PR #${prNumber} in ${owner}/${repo}...`
  );

  // Find existing summary comment, if any
  const existing = await findExistingSummaryComment(owner, repo, prNumber);
  if (!existing) {
    await createSummaryComment(owner, repo, prNumber, summaryBody);
    console.log("comment.mjs: Created new governance summary comment.");
  } else {
    await updateSummaryComment(owner, repo, existing.id, summaryBody);
    console.log(
      `comment.mjs: Updated existing governance summary comment (id=${existing.id}).`
    );
  }
}

// Execute only when run directly as a script.
if (import.meta.url === `file://${process.argv[1]}`) {
  // Node 18+ has global fetch; guard in case someone runs locally on older Node
  if (typeof fetch !== "function") {
    console.error(
      "comment.mjs: global fetch is not available. Please run on Node 18+ / 20+ (GitHub Actions uses Node 20+)."
    );
    process.exit(1);
  }

  main().catch((err) => {
    console.error(
      `comment.mjs: unexpected error while posting PR comment: ${err.message}`
    );
    process.exit(1);
  });
}
