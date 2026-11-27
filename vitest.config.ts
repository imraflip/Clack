import { defineConfig } from 'vitest/config';

export const testConfig = defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', '.internal/**'],
    environment: 'node',
  },
});

export default testConfig;
