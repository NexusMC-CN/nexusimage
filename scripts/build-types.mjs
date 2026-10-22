import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const compiler = resolve('node_modules/typescript/bin/tsc');
for (const directory of ['dist', 'dist/cjs']) {
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json', '--outDir', directory], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// The require condition needs declarations interpreted as CommonJS. Keep tsc's
// declaration text and source maps intact in a separate package boundary.
mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
