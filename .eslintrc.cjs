// Root ESLint configuration for the smart-contacts monorepo.
// Applies to all packages; individual packages may extend this config.
// Do not delete or override 'root: true' — it prevents ESLint from searching parent dirs.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  env: { browser: true, es2022: true, node: true },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
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
  },
  settings: { react: { version: '18' } },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  overrides: [
    { files: ['web/src/**', 'pwa/src/**', 'tauri/src/**'], env: { browser: true, node: false } },
  ],
}
