// ESLint rule: no-google-contacts-write
// Purpose: Block any code that could write to Google People API during Phase 1 (read-only sync).
// RO-INVARIANT: L4.1 — This rule is a static analysis guard complementing runtime checks in google-api-fetch.ts.
// Do NOT relax or remove until Phase 2 write support is explicitly approved.

'use strict';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Block writes to Google People API in Phase 1 (read-only).',
      category: 'Possible Errors',
      recommended: false,
    },
    schema: [],
    messages: {
      writeDir: 'Import from shared/src/google/contacts/write/ is forbidden in Phase 1.',
      writeEndpoint: "Write endpoint '{{literal}}' is forbidden in Phase 1.",
      writeFetch: 'Non-GET fetch to googleapis.com is forbidden in Phase 1.',
    },
  },
  create(context) {
    // Regex matching Google People API mutating RPC methods in URL paths.
    const WRITE_ENDPOINT_REGEX = /:(batchUpdate|batchDelete|deleteContact|createContact|updateContact|deleteContactPhoto|updateContactPhoto)\b/;

    return {
      // Block imports from the write/ subdirectory.
      ImportDeclaration(node) {
        if (
          typeof node.source.value === 'string' &&
          /(?:^|\/)shared\/src\/google\/contacts\/write\//.test(node.source.value)
        ) {
          context.report({ node, messageId: 'writeDir' });
        }
      },

      // Block string literals that contain write endpoint patterns.
      Literal(node) {
        if (
          typeof node.value === 'string' &&
          WRITE_ENDPOINT_REGEX.test(node.value)
        ) {
          context.report({ node, messageId: 'writeEndpoint', data: { literal: node.value } });
        }
      },

      // Block fetch() calls to googleapis.com with non-GET methods.
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'fetch' &&
          node.arguments.length >= 1 &&
          node.arguments[0].type === 'Literal' &&
          typeof node.arguments[0].value === 'string' &&
          node.arguments[0].value.includes('googleapis.com') &&
          node.arguments.length >= 2 &&
          node.arguments[1].type === 'ObjectExpression'
        ) {
          const methodProp = node.arguments[1].properties.find(
            p =>
              p.type === 'Property' &&
              p.key.type === 'Identifier' &&
              p.key.name === 'method'
          );
          if (
            methodProp &&
            methodProp.value.type === 'Literal' &&
            typeof methodProp.value.value === 'string' &&
            ['POST', 'PATCH', 'PUT', 'DELETE'].includes(
              methodProp.value.value.toUpperCase()
            )
          ) {
            context.report({ node, messageId: 'writeFetch' });
          }
        }
      },
    };
  },
};
