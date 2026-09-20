const { pathsToModuleNameMapper } = require('ts-jest');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: pathsToModuleNameMapper(
    {
      '@chicago-pizza/prisma': ['../../prisma/src'],
      '@chicago-pizza/common': ['../../common/src'],
    },
    { prefix: '<rootDir>/' },
  ),
  transform: {
    '^.+\\.ts$': ['ts-jest', {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          // TypeScript 6 no longer picks up hoisted `@types/*` on its own for
          // files compiled outside the project's `include`, and every spec is
          // excluded from tsconfig. Naming them keeps `describe`/`expect`
          // resolvable instead of failing the whole suite at collection.
          types: ['jest', 'node'],
        },
      }],
  },
  collectCoverageFrom: ['**/*.ts', '!**/index.ts'],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  forceExit: true,
};
