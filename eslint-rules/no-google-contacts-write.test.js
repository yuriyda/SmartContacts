// eslint-rules/no-google-contacts-write.test.js
// Unit tests for the no-google-contacts-write ESLint rule.
// Run with: node eslint-rules/no-google-contacts-write.test.js
// Uses ESLint's built-in RuleTester — no extra test framework needed.

'use strict';

const { RuleTester } = require('eslint');
const rule = require('./no-google-contacts-write');

const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

tester.run('no-google-contacts-write', rule, {
  valid: [
    // Safe import from read/ path
    { code: "import { foo } from './read/client'" },
    // GET fetch to googleapis.com — allowed
    {
      code: "fetch('https://people.googleapis.com/v1/people/me/connections', { method: 'GET' })",
    },
    // Unrelated string literal — not a write endpoint
    { code: "const url = 'people/c123/something_unrelated'" },
    // fetch without a method property (defaults to GET)
    {
      code: "fetch('https://people.googleapis.com/v1/people/me/connections', { headers: {} })",
    },
  ],

  invalid: [
    // Import from write/ directory
    {
      code: "import { x } from '../../shared/src/google/contacts/write/push'",
      errors: [{ messageId: 'writeDir' }],
    },
    // String literal containing a write endpoint
    {
      code: "const u = 'https://people.googleapis.com/v1/people:batchUpdate'",
      errors: [{ messageId: 'writeEndpoint' }],
    },
    // POST fetch to googleapis.com
    {
      code: "fetch('https://people.googleapis.com/x', { method: 'POST' })",
      errors: [{ messageId: 'writeFetch' }],
    },
    // PATCH fetch to googleapis.com
    {
      code: "fetch('https://people.googleapis.com/x', { method: 'PATCH' })",
      errors: [{ messageId: 'writeFetch' }],
    },
    // DELETE fetch to googleapis.com
    {
      code: "fetch('https://people.googleapis.com/x', { method: 'DELETE' })",
      errors: [{ messageId: 'writeFetch' }],
    },
  ],
});

console.log('All tests passed for no-google-contacts-write rule.');
