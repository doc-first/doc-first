import js from '@eslint/js';

/**
 * Lint for Doc First. Deliberately THIN: the pre-commit hook has to run in seconds, and a rule
 * nobody understands turns into `eslint-disable` scattered through the code.
 *
 * What is here is what has actually bitten this project — not a list of good practices copied from
 * somewhere.
 */
export default [
  {
    ignores: [
      'node_modules/**',
      // The panel bundle is generated and committed. Linting minified React output produces
      // hundreds of errors about code nobody wrote and nobody will fix.
      'review/web/painel-react.js',
    ],
  },

  js.configs.recommended,

  {
    // Node: the server, the CLI and the core.
    // TypeScript is NOT linted here, and that is a choice: linting it needs another dependency,
    // and `tsc --noEmit` already catches more than style — including unused locals and parameters,
    // which is most of what a lint would add. One tool per job.
    files: ['review/**/*.js', '*.js'],
    ignores: ['review/web/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly', crypto: 'readonly', fetch: 'readonly',
        URL: 'readonly', TextEncoder: 'readonly', Buffer: 'readonly', setTimeout: 'readonly',
      },
    },
  },

  {
    // The browser panel: classic scripts, no modules, with the DOM globals.
    files: ['review/web/*.js'],
    ignores: ['review/web/core-web.js', 'review/web/painel-react.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', fetch: 'readonly',
        console: 'readonly', crypto: 'readonly', setTimeout: 'readonly', alert: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', CustomEvent: 'readonly',
        HTMLElement: 'readonly', Element: 'readonly', TextEncoder: 'readonly',
        FormData: 'readonly',
      },
    },
  },

  {
    // The bridge is the only module in the browser: it imports the core and publishes on
    // window.DOC_FIRST.
    files: ['review/web/core-web.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { window: 'readonly', document: 'readonly', CustomEvent: 'readonly' },
    },
  },

  {
    // The React source of the panel, before bundling.
    files: ['review/web/src/**/*.js', 'review/web/src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', fetch: 'readonly',
        console: 'readonly', setTimeout: 'readonly', Element: 'readonly', Attr: 'readonly',
      },
    },
  },

  {
    // Tests run on Node with the built-in runner.
    files: ['review/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly', globalThis: 'writable', crypto: 'readonly',
        fetch: 'readonly', URL: 'readonly', Buffer: 'readonly', setTimeout: 'readonly',
        // A test that waits on something external has to be able to stop waiting. A suite that
        // hangs gets killed, and killed is not the same as failed.
        clearTimeout: 'readonly',
      },
    },
  },
];
