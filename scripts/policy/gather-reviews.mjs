#!/usr/bin/env node
/**
 * BrikByte Studios — Reviews Gatherer (PIPE-GOV-7.3.1)
 *
 * Purpose:
 *   Gather review evidence for a PR:
 *     - Target branch
 *     - Approving reviewers (users)
 *     - Teams for each reviewer (best-effort via GitHub API)
 *     - Approximate CODEOWNERS approval flag (placeholder)
 *
 * Usage (from GitHub Actions):
 *   node scripts/policy/gather-reviews.mjs --out .audit/<run>/reviews.json
 *
 * Inputs:
 *   - Environment:
 *       GITHUB_REPOSITORY   (owner/repo)
 *       GITHUB_EVENT_PATH   (path to event JSON)
 *       GITHUB_TOKEN        (for API calls)
 *
 * Output:
 *   JSON file with shape:
 *   {
 *     "branch": "main",
 *     "pr_number": 123,
 *     "approvals": [
 *       { "user": "alice", "teams": ["platform-leads"] },
 *       { "user": "bob",   "teams": ["backend-team"] }
 *     ],
 *     "code_owner_approved": true | false | null
 *   }
 */

import fs from "fs";
import path from "path";
import https from "https";

// ------------------ CLI ARG PARSER ------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.replace(/^--/, "");
    const next = argv[i + 1];
    const val = next && !next.startsWith("--") ? (i++, next) : true;
    args[key] = val;
  }
  return args;
}

// ------------------ HTTP HELPER ---------------------------------------------

function githubRequest({ method = "GET", path, token }) {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const options = {
    method,
    host: "api.github.com",
    path,
    headers: {
      "User-Agent": "brikbyteos-policy-gate",
      "Accept": "application/vnd.github+json",
      Authorization: `Bearer ${token}`
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(
              new Error(
                `Failed to parse GitHub response JSON (${res.statusCode}): ${err.message}`
              )
            );
          }
        } else {
          reject(
            new Error(
              `GitHub API request failed (${res.statusCode}): ${data.slice(0, 300)}`
            )
          );
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.end();
  });
}

// Map user → teams for required_roles resolution.
// NOTE: Best-effort; we assume required_roles are GitHub team slugs.
async function fetchUserTeams({ org, username, token, requiredRoles }) {
  if (!requiredRoles || requiredRoles.length === 0) return [];

  const teams = [];
  for (const role of requiredRoles) {
    try {
      const path = `/orgs/${encodeURIComponent(
        org
      )}/teams/${encodeURIComponent(role)}/memberships/${encodeURIComponent(
        username
      )}`;
      await githubRequest({ method: "GET", path, token });
      // If we get here without error, user is a member of that team.
      teams.push(role);
    } catch {
      // Not a member of this team (or team doesn't exist) – ignore.
    }
  }
  return teams;
}

// ------------------ MAIN -----------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const outPath = args.out || "reviews.json";

  const repoSlug = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!repoSlug) {
    console.error("❌ GITHUB_REPOSITORY not set; cannot determine repo.");
    process.exit(1);
  }
  if (!token) {
    console.error("❌ GITHUB_TOKEN not set; cannot call GitHub API.");
    process.exit(1);
  }
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.error(
      `❌ GITHUB_EVENT_PATH not set or missing: ${eventPath || "<unset>"}`
    );
    process.exit(1);
  }

  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (!event.pull_request) {
    console.error("❌ Event does not contain pull_request; this gate expects a PR event.");
    process.exit(1);
  }

  const prNumber = event.pull_request.number;
  const branch = event.pull_request.base?.ref;
  if (!branch) {
    console.error("❌ Could not resolve base branch from pull_request.base.ref.");
    process.exit(1);
  }

  const [owner, repo] = repoSlug.split("/");
  console.log(`ℹ️ Gathering review data for ${owner}/${repo}#${prNumber} on branch ${branch}`);

  // Fetch all reviews for the PR
  const reviewsPath = `/repos/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews`;
  const reviews = await githubRequest({ path: reviewsPath, token });

  // Filter APPROVED reviews and dedupe by user (last state wins).
  const approvalsByUser = new Map();
  for (const review of reviews) {
    if (review.state !== "APPROVED") continue;
    const username = review.user?.login;
    if (!username) continue;
    approvalsByUser.set(username, review);
  }

  // In v1 we don't know which roles are required yet; the evaluator will
  // compute requiredRoles from policy and call this script beforehand.
  // To keep this script generic, we gather teams only when a hint is provided.
  const requiredRolesHint =
    typeof args.required_roles === "string"
      ? args.required_roles.split(",").map((s) => s.trim())
      : [];

  const approvals = [];
  for (const [username, review] of approvalsByUser.entries()) {
    const teams = await fetchUserTeams({
      org: owner,
      username,
      token,
      requiredRoles: requiredRolesHint
    });

    // NOTE: CODEOWNERS is not directly exposed as a boolean on reviews.
    // We approximate here; a future version can integrate with a CODEOWNERS parser.
    const association = review.author_association || "UNKNOWN";

    approvals.push({
      user: username,
      teams,
      author_association: association
    });
  }

  // Approximate code_owner_approved:
  const codeOwnerApproved =
    approvals.some((a) =>
      ["OWNER", "MEMBER"].includes(a.author_association.toUpperCase())
    ) || null;

  const result = {
    branch,
    pr_number: prNumber,
    approvals,
    code_owner_approved: codeOwnerApproved
  };

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");

  console.log(`✅ Reviews evidence written to ${outPath}`);
}

main().catch((err) => {
  console.error(`❌ gather-reviews failed: ${err.message}`);
  process.exit(1);
});
