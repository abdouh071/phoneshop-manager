import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run in Node (no DOM needed — pure utility functions)
    environment: 'node',
    // Glob patterns for test files
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts'],
    // Report per-file with per-test durations
    reporter: ['verbose'],
    // Fail fast on first error in CI
    bail: 0,
    // Code coverage (run with `vitest --coverage`)
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/store/**', 'src/services/**'],
      exclude: ['src/**/*.test.*', 'src/**/*.spec.*'],
    },
  },
});
