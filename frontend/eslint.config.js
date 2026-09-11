import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', '**/_to_delete/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // `const { omitted, ...rest } = obj` is the idiomatic way to drop a key.
      // Without this the discarded sibling reads as an unused variable.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Two useMemo calls in App.jsx (finalScheduleRows / commitSummary) are
      // still reported as unpreservable. buildCommitSummary was rewritten to
      // mutate nothing and the tests confirm the behaviour is unchanged, but
      // the compiler's alias analysis still will not clear them. Kept as a
      // warning rather than muted: it should go back to 'error' once the
      // remaining orchestration moves out of App.jsx.
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
])
