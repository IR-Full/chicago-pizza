import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

/**
 * The server had no linter at all: no config, no package, and a `lint` script
 * in one workspace out of nine that failed the moment it was run. Thirty
 * thousand lines of TypeScript were going out unchecked, and CI only linted
 * the client — which is why nobody noticed.
 *
 * The rules below are deliberately few. A linter that fires on style
 * arguments gets switched off; these catch the things that actually shipped
 * bugs here — a floating promise, a silently swallowed `any`, an `await` that
 * was forgotten inside a transaction.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.mjs',
      'libs/prisma/prisma/**',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  security.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        // One program covering everything, specs included. The build configs
        // exclude `*.spec.ts`, so `projectService` refused to parse the tests
        // — which would have left the largest part of the codebase unlinted.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // ── The ones that caught real bugs ──────────────────────
      // A promise dropped inside a transaction commits the transaction
      // without the write. This is the single most valuable rule here.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // `any` is how a payload from RabbitMQ stops being checked at all.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      '@typescript-eslint/no-unused-vars': [
        'error',
        // A leading underscore is the established way here to say "required
        // by the signature, deliberately unused" — see the event handlers.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // ── Turned off, with reasons ────────────────────────────
      // Prisma's generated types use `any` internally; every service method
      // that touches a delegate would otherwise be a wall of warnings.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Every "non-literal fs filename" in this codebase is a constant path
      // in a build script. The rule fires only on those, so it is noise.
      'security/detect-non-literal-fs-filename': 'off',
      // Fires on every `obj[key]` including our own enum lookups; the real
      // prototype-pollution risk is covered by validating DTOs at the edge.
      'security/detect-object-injection': 'off',
    },
  },

  {
    // Specs construct partial doubles and reach into private state on
    // purpose; holding them to the production rules would mean weakening the
    // production rules.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-unsafe-regex': 'off',

      // `jest.fn(async () => …)` has no `await` and must not: the double has
      // to return a promise because the thing it replaces does.
      '@typescript-eslint/require-await': 'off',

      // `as never` is how a partial double is handed to a constructor that
      // wants the full service. The assertion reads as unnecessary to the
      // type checker precisely because it is doing its job.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',

      // Module specs `require()` after setting the environment, so the
      // module factory runs against the env the test just arranged.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
