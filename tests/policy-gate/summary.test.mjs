import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSummary } from '../../scripts/policy/summary.mjs';

import {
  decisionAllPass,
  expectedAllPassMarkdown,
  decisionWarnFail,
  decisionMissingEvidence,
} from './summary.fixtures.mjs';

/**
 * Helper: normalize whitespace so tests aren’t brittle on trailing spaces / CRLF.
 */
function normalize(md) {
  return md
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '');
}

test('summary: all rules pass, no waivers, no missing evidence', () => {
  const markdown = normalize(renderSummary(decisionAllPass));
  const expected = normalize(expectedAllPassMarkdown);

  assert.equal(
    markdown,
    expected,
    'Markdown summary should match golden snapshot for all-pass case'
  );
});

test('summary: failing rule with waiver & non-waived failure shows recommended fixes', () => {
  const markdown = normalize(renderSummary(decisionWarnFail));

  // Header & meta
  assert.ok(
    markdown.includes('**Overall Status:** ⚠️ Passed with Warnings'),
    'Overall status should show "Passed with Warnings"'
  );
  assert.ok(
    markdown.includes('**Policy Version:** v1.1.0'),
    'Policy version should be printed'
  );
  assert.ok(
    markdown.includes('**Target Env:** prod'),
    'Target environment should be visible in header'
  );
  assert.ok(
    markdown.includes('hotfix/payment-retry'),
    'Branch name should be present in header'
  );

  // Rule table rows
  assert.ok(
    markdown.includes('| tests.green'),
    'Rule table should include tests.green row'
  );
  assert.ok(
    markdown.includes('| coverage.min'),
    'Rule table should include coverage.min row'
  );
  assert.ok(
    markdown.includes('| security.sca'),
    'Rule table should include security.sca row'
  );
  assert.ok(
    markdown.includes('WVR-2025-001'),
    'Coverage rule details should mention waiver ID'
  );

  // Recommended fixes
  assert.ok(
    markdown.includes('### Recommended Fixes'),
    'Recommended Fixes section heading should be present'
  );
  assert.ok(
    markdown.includes('coverage.min') &&
      markdown.includes('Increase tests on payment retry'),
    'Recommended fixes should include hint for coverage.min'
  );
  assert.ok(
    markdown.includes('security.sca') &&
      markdown.includes('Upgrade libX to ≥ 1.2.4'),
    'Recommended fixes should include hint for security.sca'
  );
});

test('summary: missing evidence is surfaced in summary', () => {
  const markdown = normalize(renderSummary(decisionMissingEvidence));

  assert.ok(
    markdown.includes('**Overall Status:** ❌ Failed'),
    'Overall status should indicate failure'
  );
  assert.ok(
    markdown.includes('Coverage report missing for this run'),
    'Rule detail should mention missing coverage message'
  );
  assert.ok(
    /missing evidence/i.test(markdown),
    'Summary should mention missing evidence'
  );
  assert.ok(
    markdown.includes('coverage.min'),
    'Missing evidence section or rule list should reference coverage.min'
  );
  assert.ok(
    markdown.includes('### Recommended Fixes'),
    'Recommended fixes section should still appear'
  );
  assert.ok(
    markdown.includes('Ensure coverage job publishes report artifact'),
    'Remediation hint for missing evidence should be present'
  );
});
