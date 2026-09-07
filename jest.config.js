module.exports = {
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  collectCoverageFrom: [
    'src/lib/importers/parsers.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // react-native-anydoc pulls in Nitro at import-time; we don't load the
    // native bridge in Jest. Tests should never invoke `convertDocumentToIr`
    // — only the pure functions that consume the resulting IR.
    '^react-native-anydoc$': '<rootDir>/src/__mocks__/react-native-anydoc.ts',
    '^react-native-nitro-modules$': '<rootDir>/src/__mocks__/react-native-nitro-modules.ts',
  },
};