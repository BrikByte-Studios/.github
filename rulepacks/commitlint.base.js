/**
 * BrikByteOS canonical Conventional Commits rules.
 * Enforce type(scope): subject with enforced scope and 100-char header cap.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allowed types for BrikByteOS
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
    ],
    // Require a scope to encourage ownership (e.g., feat(api):, fix(testing):)
    'scope-empty': [2, 'never'],
    // Max header length
    'header-max-length': [2, 'always', 100],
    // Subject should not end with a period
    'subject-full-stop': [2, 'never', '.']
  }
};
