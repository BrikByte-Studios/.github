/**
 * Smoke tests for ADR gate evaluation (PIPE-GOV-7.3.4)
 *
 * This is intentionally simple and CLI-friendly:
 *   node tests/policy/adr-checks.smoke.mjs
 */

import { evaluateAdrGate } from "../../scripts/policy/eval-adr.mjs";

function assert(cond, message) {
  if (!cond) {
    throw new Error(message || "Assertion failed");
  }
}

function logPass(name) {
  console.log(`✓ PASS (ADR): ${name}`);
}

async function run() {
  // 1) Infra change with NO ADR reference → fail
  {
    const adrConfig = {
      required_on_paths: ["infra/**"],
      require_accepted_adr: true,
      adr_file_glob: "docs/adr/[0-9][0-9][0-9]-*.md"
    };

    const decision = evaluateAdrGate(adrConfig, {
      changedFiles: ["infra/cluster.tf"],
      prBody: "This PR tweaks cluster capacity.", // no ADR-XXXX
      adrMetaById: {},
      waivers: []
    });

    assert(decision.adr_required === true, "ADR should be required for infra path");
    assert(decision.result === "fail", "Expected ADR gate to fail when missing ADR reference");
    logPass("infra change without ADR reference fails gate");
  }

  // 2) ADR referenced, but not Accepted → fail
  {
    const adrConfig = {
      required_on_paths: ["infra/**"],
      require_accepted_adr: true,
      adr_file_glob: "docs/adr/[0-9][0-9][0-9]-*.md"
    };

    const decision = evaluateAdrGate(adrConfig, {
      changedFiles: ["infra/cluster.tf"],
      prBody: "Implements new infra pattern. Ref: ADR-0007",
      adrMetaById: {
        "ADR-0007": {
          id: "ADR-0007",
          path: "docs/adr/007-new-infra.md",
          status: "Proposed",
          schemaOk: true,
          schemaErrors: []
        }
      },
      waivers: []
    });

    assert(decision.result === "fail", "Expected fail when ADR not Accepted");
    logPass("ADR with non-Accepted status causes ADR gate failure");
  }

  // 3) ADR referenced, Accepted, schema OK → pass
  {
    const adrConfig = {
      required_on_paths: ["infra/**"],
      require_accepted_adr: true,
      adr_file_glob: "docs/adr/[0-9][0-9][0-9]-*.md"
    };

    const decision = evaluateAdrGate(adrConfig, {
      changedFiles: ["infra/cluster.tf"],
      prBody: "Implements new infra pattern. See ADR-0008.",
      adrMetaById: {
        "ADR-0008": {
          id: "ADR-0008",
          path: "docs/adr/008-new-infra-accepted.md",
          status: "Accepted",
          schemaOk: true,
          schemaErrors: []
        }
      },
      waivers: []
    });

    assert(decision.result === "pass", "Expected ADR gate to pass with valid Accepted ADR");
    logPass("ADR Accepted + valid schema → gate passes");
  }
}

run()
  .then(() => {
    console.log("✅ ADR smoke tests completed");
    process.exit(0);
  })
  .catch((err) => {
    console.error(`✗ FAIL (ADR smoke tests): ${err.message}`);
    process.exit(1);
  });
