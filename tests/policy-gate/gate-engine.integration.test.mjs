#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluatePolicyGate } from "../../scripts/policy/gate-engine.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadJson(relPath) {
  const full = path.join(__dirname, "..", "fixtures", "policy-gate", relPath);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

(async () => {
  try {
    const policyStrict = loadJson("policy.strict.json");
    const inputsGood = loadJson("inputs.good.json");
    const inputsBadCoverage = loadJson("inputs.bad-coverage.json");
    const inputsBadSca = loadJson("inputs.bad-sca.json");
    const waiversSca = loadJson("waivers.sca.json");

    // 1) Happy path
    const happyDecision = evaluatePolicyGate(policyStrict, inputsGood, []);
    console.log("Happy-path decision:", happyDecision);
    assert.equal(happyDecision.status, "passed");
    assert.ok(happyDecision.score >= 80);

    // 2) Coverage fail scenario (no waivers)
    const coverageDecision = evaluatePolicyGate(policyStrict, inputsBadCoverage, []);
    console.log("Coverage-fail decision:", coverageDecision);

    const coverageRule = coverageDecision.rules.find(
      (r) => r.id === "coverage.min"
    );
    assert.ok(coverageRule, "coverage.min rule should exist");
    assert.equal(
      coverageRule.result,
      "fail",
      "Expected coverage.min to be failing in bad-coverage scenario"
    );
    assert.equal(coverageDecision.status, "failed");

    // 3) SCA fail without waivers
    const scaDecisionNoWaiver = evaluatePolicyGate(
      policyStrict,
      inputsBadSca,
      []
    );
    console.log("SCA-fail (no waiver) decision:", scaDecisionNoWaiver);

    const scaRuleNoWaiver = scaDecisionNoWaiver.rules.find(
      (r) => r.id === "security.sca"
    );
    assert.ok(scaRuleNoWaiver, "security.sca rule should exist");
    assert.equal(
      scaRuleNoWaiver.result,
      "fail",
      "SCA should be failing before waiver semantics are applied"
    );
    assert.equal(scaRuleNoWaiver.waived, false);
    assert.equal(
      scaDecisionNoWaiver.status,
      "failed",
      "Unwaived block SCA failure should produce overall failed status"
    );

    // 4) SCA fail with active waiver → soften to passed_with_warnings
    const scaDecisionWithWaiver = evaluatePolicyGate(
      policyStrict,
      inputsBadSca,
      waiversSca
    );
    console.log("SCA-fail (with waiver) decision:", scaDecisionWithWaiver);

    const scaRuleWithWaiver = scaDecisionWithWaiver.rules.find(
      (r) => r.id === "security.sca"
    );
    assert.ok(scaRuleWithWaiver, "security.sca rule should exist");
    assert.equal(
      scaRuleWithWaiver.result,
      "fail",
      "Waived SCA violation remains a fail at rule level"
    );
    assert.equal(
      scaRuleWithWaiver.waived,
      true,
      "SCA rule should be marked waived when waiver is applied"
    );

    assert.equal(
      scaDecisionWithWaiver.status,
      "passed_with_warnings",
      "Expected security.sca waiver to soften the decision (no overall 'failed' status)"
    );

    console.log("✓ gate-engine.integration.test.mjs: all scenarios passed.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
