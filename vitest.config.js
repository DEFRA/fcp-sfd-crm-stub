import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['**/test/**/*.test.js'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90
      },
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      exclude: [...configDefaults.exclude, 'coverage', '**/test/**'],
      clean: false
    },
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
})
