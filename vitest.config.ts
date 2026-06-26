/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Use forks instead of threads for Vite 6 compatibility (threads can hang).
    pool: 'forks',
  },
});
