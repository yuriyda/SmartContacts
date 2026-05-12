// eslint-rules/index.js
// ESLint plugin entry point for local smart-contacts rules.
// Registers all custom rules under the 'local' plugin namespace.
// To add a new rule: add the require() here and reference it as 'local/<rule-name>' in .eslintrc.cjs.

'use strict';

module.exports = {
  rules: {
    'no-google-contacts-write': require('./no-google-contacts-write'),
  },
};
