/// <reference types="vite/client" />
import { resolve } from 'node:path';
import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'semanticSelector',
      fileName: 'semantic-selector',
      formats: ['es', 'cjs', 'umd'],
    },
    sourcemap: true,
    minify: false,
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
      afterBuild: (emitted: Map<string, string>) => {
        // Emit .d.cts alongside .d.ts so the `require` exports condition
        // resolves to ESM-correct types (passes publint).
        for (const file of emitted.keys()) {
          copyFileSync(file, file.replace('.d.ts', '.d.cts'));
        }
      },
    }),
  ],
});
