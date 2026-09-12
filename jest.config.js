module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // react-native-anydoc pulls in Nitro at import-time; we don't load the
    // native bridge in Jest. Tests should never invoke `convertDocumentToIr`
    // — only the pure functions that consume the resulting IR.
    '^react-native-anydoc$': '<rootDir>/src/__mocks__/react-native-anydoc.ts',
    '^react-native-nitro-modules$': '<rootDir>/src/__mocks__/react-native-nitro-modules.ts',
  },
};
