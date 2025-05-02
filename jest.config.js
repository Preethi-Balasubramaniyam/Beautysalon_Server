module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest',  { tsconfig: 'tsconfig-test.json' }],
  },
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
};