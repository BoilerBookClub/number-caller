import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  /* Local scratch: one-off harnesses and probe scripts that exist to look at a
     component in isolation. They are gitignored, they are not part of the app,
     and linting them fails the build for rules that only make sense for code
     that ships — a harness has no exports to fast-refresh. */
  globalIgnores(['dist', 'harness.*', 'scratch-*']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      /*
       * Marks anything referenced from JSX as used.
       *
       * Core no-unused-vars only sees identifiers in ordinary expressions, so
       * without this every component in the app reads as unused. That is why
       * the pattern below used to be '^[A-Z_]' — it was not a style choice, it
       * was the only way to stop the rule firing on all of them, and the cost
       * was that it also exempted every SCREAMING_CASE constant and every
       * component import that had genuinely stopped being rendered. With the
       * JSX references actually counted, the pattern can go back to meaning
       * what it says.
       */
      'react/jsx-uses-vars': 'error',
      /* '^_' rather than '^[A-Z_]': underscore marks a deliberate throwaway,
         and nothing else is exempt. */
      'no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
      // Catches temporal dead zone errors, which are runtime-only: the build
      // succeeds and the page then fails to load with a blank screen.
      'no-use-before-define': [
        'error',
        { classes: true, functions: false, variables: true },
      ],
    },
  },
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
])
