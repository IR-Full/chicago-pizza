const { pathsToModuleNameMapper } = require('ts-jest');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: pathsToModuleNameMapper(
    {
      '@chicago-pizza/prisma': ['../../../libs/prisma/src'],
      '@chicago-pizza/common': ['../../../libs/common/src'],
      '@chicago-pizza/rabbitmq': ['../../../libs/rabbitmq/src'],
    },
    { prefix: '<rootDir>/' },
  ),
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          // TypeScript 6 no longer picks up hoisted `@types/*` on its own for
          // files compiled outside the project's `include`, and every spec is
          // excluded from tsconfig. Naming them keeps `describe`/`expect`
          // resolvable instead of failing the whole suite at collection.
          types: ['jest', 'node'],
        },
      },
    ],
  },
  // Coverage spans the whole service; only the bootstrap file is out of scope
  // because it exists to wire Nest to a live broker and HTTP port.
  collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/index.ts'],
  // Jest defaults this to `<rootDir>/coverage`, and rootDir is `src` — so a
  // coverage run used to drop a full HTML report *inside the sources*, where
  // it is picked up by editor search and by `tsc`. Git and Docker ignore it
  // either way; this keeps it out of the tree in the first place.
  coverageDirectory: '../coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  // Importing the shared barrel pulls in ioredis/socket.io, whose module-level
  // handles keep the worker alive after the suite finishes.
  forceExit: true,
};
