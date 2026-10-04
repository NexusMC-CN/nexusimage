import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/fastify.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ['sharp', 'nexusimage', '@fastify/multipart', 'fastify-plugin', 'fastify'],
});
