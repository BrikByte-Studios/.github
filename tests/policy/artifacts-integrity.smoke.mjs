// tests/policy/artifacts-integrity.smoke.mjs
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateArtifacts } from "../../scripts/policy/eval-artifacts.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function basePolicy() {
  return {
    artifacts: {
      require_sbom: true,
      require_hashes: true,
      require_signatures: true,
      hash_algorithm: "sha256",
      // optional extra defaults if you like:
      sbom_path: "artifacts/sbom.spdx.json",
      hashes_manifest_path: "artifacts/manifest.json",
      signature: {
        tool: "cosign",
        verify_subject: "BrikByte-Studios",
        status_path: "artifacts/signature-status.json"
      }
    }
  };
}

function tmpPath(rel) {
  return path.join(__dirname, "..", "..", ".tmp-artifacts-test", rel);
}

function ensureTmpDir() {
  const dir = tmpPath("");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// --- 1. Missing SBOM must fail ----------------------------------------------

function test_missing_sbom() {
  const policy = basePolicy();
  ensureTmpDir();

  const artifactsInfo = {
    enforced: true,
    branch: "refs/heads/release/v1.2.3",
    target_env: "prod",

    sbom_path: tmpPath("sbom.spdx.json"), // does NOT exist
    sbom_exists: false,

    hashes_manifest_path: tmpPath("manifest.json"),
    hashes_manifest_exists: true,
    hashes_manifest_error: null,
    hashes_manifest: { "artifacts/app.tgz": "abcd" },

    signature: {
      tool: "cosign",
      status_path: tmpPath("signature-status.json"),
      status_exists: true,
      signature_verified: true,
      failure_reason: null
    }
  };

  // create manifest + signature status so only SBOM is missing
  fs.writeFileSync(
    artifactsInfo.hashes_manifest_path,
    JSON.stringify(artifactsInfo.hashes_manifest, null, 2)
  );
  fs.writeFileSync(
    artifactsInfo.signature.status_path,
    JSON.stringify({ signature_verified: true }, null, 2)
  );

  const { decision, hasFailures } = evaluateArtifacts({
    policy,
    artifactsInfo,
    decision: {}
  });

  assert.strictEqual(
    hasFailures,
    true,
    "Missing SBOM must fail"
  );
  assert.strictEqual(
    decision.artifacts.result,
    "fail",
    "Artifacts result should be 'fail' when SBOM is missing"
  );
}

// --- 2. Missing manifest must fail ------------------------------------------

function test_missing_manifest() {
  const policy = basePolicy();
  ensureTmpDir();

  const sbomPath = tmpPath("sbom.spdx.json");
  fs.writeFileSync(sbomPath, '{"spdxVersion":"SPDX-2.3"}');

  const artifactsInfo = {
    enforced: true,
    branch: "refs/heads/release/v1.2.3",
    target_env: "prod",

    sbom_path: sbomPath,
    sbom_exists: true,

    hashes_manifest_path: tmpPath("manifest.json"),
    hashes_manifest_exists: false,
    hashes_manifest_error: "ENOENT",

    signature: {
      tool: "cosign",
      status_path: tmpPath("signature-status.json"),
      status_exists: true,
      signature_verified: true,
      failure_reason: null
    }
  };

  fs.writeFileSync(
    artifactsInfo.signature.status_path,
    JSON.stringify({ signature_verified: true }, null, 2)
  );

  const { decision, hasFailures } = evaluateArtifacts({
    policy,
    artifactsInfo,
    decision: {}
  });

  assert.strictEqual(
    hasFailures,
    true,
    "Missing hash manifest must fail"
  );
  assert.strictEqual(
    decision.artifacts.result,
    "fail",
    "Artifacts result should be 'fail' when manifest is missing"
  );
}

// --- 3. Failed signature must fail ------------------------------------------

function test_failed_signature() {
  const policy = basePolicy();
  ensureTmpDir();

  const sbomPath = tmpPath("sbom.spdx.json");
  const manifestPath = tmpPath("manifest.json");
  fs.writeFileSync(sbomPath, '{"spdxVersion":"SPDX-2.3"}');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ "artifacts/app.tgz": "abcd" }, null, 2)
  );

  const artifactsInfo = {
    enforced: true,
    branch: "refs/heads/release/v1.2.3",
    target_env: "prod",

    sbom_path: sbomPath,
    sbom_exists: true,

    hashes_manifest_path: manifestPath,
    hashes_manifest_exists: true,
    hashes_manifest_error: null,
    hashes_manifest: { "artifacts/app.tgz": "abcd" },

    signature: {
      tool: "cosign",
      status_path: tmpPath("signature-status.json"),
      status_exists: true,
      signature_verified: false,
      failure_reason: "cosign verify failed (bad signature)"
    }
  };

  fs.writeFileSync(
    artifactsInfo.signature.status_path,
    JSON.stringify(
      {
        signature_verified: false,
        failure_reason: artifactsInfo.signature.failure_reason
      },
      null,
      2
    )
  );

  const { decision, hasFailures } = evaluateArtifacts({
    policy,
    artifactsInfo,
    decision: {}
  });

  assert.strictEqual(
    hasFailures,
    true,
    "Failed signature must fail"
  );
  assert.strictEqual(
    decision.artifacts.result,
    "fail",
    "Artifacts result should be 'fail' on signature failure"
  );
}

// --- 4. Happy path must pass -------------------------------------------------

function test_happy_path() {
  const policy = basePolicy();
  ensureTmpDir();

  const sbomPath = tmpPath("sbom.spdx.json");
  const manifestPath = tmpPath("manifest.json");
  const sigStatusPath = tmpPath("signature-status.json");

  fs.writeFileSync(sbomPath, '{"spdxVersion":"SPDX-2.3"}');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ "artifacts/app.tgz": "abcd" }, null, 2)
  );
  fs.writeFileSync(
    sigStatusPath,
    JSON.stringify({ signature_verified: true }, null, 2)
  );

  const artifactsInfo = {
    enforced: true,
    branch: "refs/heads/release/v1.2.3",
    target_env: "prod",

    sbom_path: sbomPath,
    sbom_exists: true,

    hashes_manifest_path: manifestPath,
    hashes_manifest_exists: true,
    hashes_manifest_error: null,
    hashes_manifest: { "artifacts/app.tgz": "abcd" },

    signature: {
      tool: "cosign",
      status_path: sigStatusPath,
      status_exists: true,
      signature_verified: true,
      failure_reason: null
    }
  };

  const { decision, hasFailures } = evaluateArtifacts({
    policy,
    artifactsInfo,
    decision: {}
  });

  assert.strictEqual(
    hasFailures,
    false,
    "Happy-path artifacts must not fail"
  );
  assert.strictEqual(
    decision.artifacts.result,
    "pass",
    "Artifacts result should be 'pass' when all integrity checks succeed"
  );
}

// Run all smoke tests
test_missing_sbom();
test_missing_manifest();
test_failed_signature();
test_happy_path();

console.log("✅ artifacts-integrity.smoke: all scenarios passed");
