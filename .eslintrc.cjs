// Root ESLint configuration for the smart-contacts monorepo.
// Applies to all packages; individual packages may extend this config.
// Do not delete or override 'root: true' — it prevents ESLint from searching parent dirs.
// 'local' plugin (eslint-plugin-local) is defined in ./eslint-rules/ and enforces
// Phase 1 read-only invariants (L4.1). Do not remove until Phase 2 write support is approved.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  env: { browser: true, es2022: true, node: true },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'local'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react-hooks/exhaustive-deps': 'error',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // RO-INVARIANT L4.1: Block any write paths to Google People API in Phase 1.
    'local/no-google-contacts-write': 'error',
  },
  settings: { react: { version: '18' } },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  overrides: [
    { files: ['web/src/**', 'pwa/src/**', 'tauri/src/**'], env: { browser: true, node: false } },
    // Test files are allowed to reference write endpoints as string literals to verify guards reject them.
    // The rule still applies to non-test production code.
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', 'eslint-rules/**'],
      rules: { 'local/no-google-contacts-write': 'off' },
    },
  ],
}
