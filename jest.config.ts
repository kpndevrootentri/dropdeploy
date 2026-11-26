import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
  // .tsx suites opt into a browser-like DOM with a `@jest-environment jsdom` docblock.
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Count every source file, not only the ones a test happens to import.
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/__tests__/**', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
};

export default config;
