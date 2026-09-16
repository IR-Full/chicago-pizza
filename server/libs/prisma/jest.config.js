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
    '^.+\\.ts$': ['ts-jest', { tsconfig: { experimentalDecorators: true, emitDecoratorMetadata: true } }],
  },
  collectCoverageFrom: ['**/*.ts', '!**/index.ts', '!**/seed.ts'],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  forceExit: true,
};
