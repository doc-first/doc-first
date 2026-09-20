import js from '@eslint/js';

/**
 * Lint do Doc First. Deliberadamente ENXUTO: o pré-commit precisa rodar em segundos, e regra que
 * ninguém entende vira `eslint-disable` espalhado pelo código.
 *
 * O que está aqui é o que já nos mordeu de verdade neste projeto — não uma lista de boas práticas
 * copiada de algum lugar.
 */
export default [
  { ignores: ['node_modules/**', 'front/telas.bak-*/**', 'publicar/site/**', 'publicar/api/**'] },

  js.configs.recommended,

  {
    // A ponte é o único módulo do front: ela importa o núcleo e expõe em window.ARAUTOS.
    files: ['front/js/core-web.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module',
      globals: { window: 'readonly', document: 'readonly', CustomEvent: 'readonly' } },
  },

  {
    // O navegador: scripts clássicos, sem módulos, com as globais do DOM.
    files: ['front/js/*.js'],
    ignores: ['front/js/core-web.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', fetch: 'readonly',
        console: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
        crypto: 'readonly', TextEncoder: 'readonly', CustomEvent: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', Promise: 'readonly',
        FormData: 'readonly', CSS: 'readonly', addEventListener: 'readonly',
        performance: 'readonly', getComputedStyle: 'readonly', Element: 'readonly',
        matchMedia: 'readonly', alert: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // catch vazio engole erro de rede E erro de programação: um bug fica invisível, sem console e
      // sem tela. Aconteceu aqui, no contador do menu.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'smart'],
    },
  },

  {
    // O núcleo compartilhado: ESM puro, roda no navegador E no servidor.
    files: ['review/core/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { crypto: 'readonly', TextEncoder: 'readonly', console: 'readonly' },
    },
    rules: {
      'no-unused-vars': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],   // aqui o catch vazio é deliberado e comentado
      eqeqeq: ['error', 'smart'],
    },
  },

  {
    files: ['review/tests/*.js'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'module',
      globals: { console: 'readonly', crypto: 'readonly', process: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-unused-vars': 'warn' },
  },
];
