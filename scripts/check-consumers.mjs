import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'tests/consumers');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run test:consumers.');
const temporary = mkdtempSync(join(tmpdir(), 'nexusimage-consumers-'));

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

try {
  mkdirSync(join(temporary, 'node_modules/@nexusmc-cn'), { recursive: true });
  for (const packageDirectory of ['browser', 'server']) {
    const packageRoot = join(root, 'packages', packageDirectory);
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const packed = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    if (packed.status !== 0) throw new Error(packed.stderr || 'Could not inspect the package file list.');
    const destination = join(temporary, 'node_modules', metadata.name);
    for (const file of JSON.parse(packed.stdout)[0].files) {
      const target = join(destination, file.path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(packageRoot, file.path), target);
    }
  }
  for (const dependency of ['@fastify/multipart', 'fastify-plugin', 'sharp', 'fastify']) {
    const destination = join(temporary, 'node_modules', dependency);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(
      join(root, 'packages/server/node_modules', dependency),
      destination,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
  for (const name of ['browser.mts', 'browser.cts', 'node.mts', 'node.cts', 'runtime.mjs']) {
    cpSync(join(fixture, name), join(temporary, name));
  }
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const commonOptions = {
    target: 'ES2022',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: ['node'],
    typeRoots: [join(fixture, 'node_modules/@types')],
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
  };
  const compiler = join(root, 'packages/browser/node_modules/typescript/bin/tsc');
  let passed = true;
  for (const module of ['NodeNext', 'Node16', 'Bundler']) {
    const files =
      module === 'Bundler' ? ['browser.mts', 'node.mts'] : ['browser.mts', 'browser.cts', 'node.mts', 'node.cts'];
    const project = join(temporary, `tsconfig.${module}.json`);
    writeFileSync(
      project,
      JSON.stringify({
        compilerOptions: {
          ...commonOptions,
          module: module === 'Bundler' ? 'ESNext' : module,
          moduleResolution: module,
        },
        files,
      }),
    );
    console.log(`Checking published declarations with ${module} (skipLibCheck: false).`);
    if (!run([compiler, '-p', project], temporary)) passed = false;
  }
  if (!run([join(temporary, 'runtime.mjs')], temporary)) passed = false;
  if (!passed) process.exitCode = 1;
} finally {
  const resolvedTemporary = realpathSync(temporary);
  const resolvedParent = realpathSync(tmpdir());
  if (
    dirname(resolvedTemporary) !== resolvedParent ||
    !resolvedTemporary.startsWith(join(resolvedParent, 'nexusimage-consumers-'))
  ) {
    throw new Error(`Refusing to remove unexpected consumer directory: ${resolvedTemporary}`);
  }
  rmSync(resolvedTemporary, { recursive: true, force: true });
}
