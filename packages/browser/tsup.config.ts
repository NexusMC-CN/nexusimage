import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/contracts.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
