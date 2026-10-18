import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

// Check the real checkout too: a fixture-only test could miss a CI checkout
// performed before core.autocrlf was configured.
const entries = git(root, 'ls-files', '--eol', '-z').split('\0').filter(Boolean);
for (const entry of entries) {
  const [metadata, path] = entry.split('\t');
  if (metadata.includes('eol=lf')) {
    assert(!readFileSync(join(root, path)).includes(Buffer.from('\r\n')), `${path}: CRLF in LF checkout`);
  }
}

const temp = mkdtempSync(join(tmpdir(), 'nexusimage-eol-'));
try {
  const seed = join(temp, 'seed');
  mkdirSync(seed);
  git(seed, 'init', '--quiet');
  git(seed, 'config', 'core.autocrlf', 'false');
  git(seed, 'config', 'user.name', 'Line ending regression test');
  git(seed, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(seed, '.gitattributes'), readFileSync(join(root, '.gitattributes')));

  const textPaths = [
    'packages/browser/src/example.ts',
    'scripts/example.mjs',
    'example.js',
    'example.cjs',
    'package.json',
    'README.md',
    '.github/workflows/example.yml',
    'example.yaml',
    'example.sh',
    '.gitignore',
    'packages/server/LICENSE',
  ];
  // Deliberately text-looking binary/compiled payloads catch accidental text
  // normalization even when Git's binary heuristic would not detect them.
  const rawPaths = [
    ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'wasm', 'node', 'zip', 'gz', 'tgz'].map(
      (extension) => `assets/example.${extension}`,
    ),
    'packages/browser/dist/example.js',
    'packages/server/dist/example.json',
    'coverage/example.json',
    'test-results/example.json',
    'playwright-report/example.js',
    'assets/unknown.dat',
  ];
  const raw = Buffer.from('preserve\r\nthese bytes\r\n');
  const unknownBinary = Buffer.from([0, 13, 10, 255, 13, 10]);
  for (const path of [...textPaths, ...rawPaths]) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), path.endsWith('.dat') ? unknownBinary : raw);
  }
  git(seed, 'add', '--all');
  git(seed, '-c', 'core.hooksPath=' + temp, 'commit', '--quiet', '-m', 'Line ending fixtures');

  for (const autocrlf of ['false', 'input', 'true']) {
    const checkout = join(temp, autocrlf);
    git(temp, 'clone', '--quiet', '--no-checkout', '-c', `core.autocrlf=${autocrlf}`, seed, checkout);
    git(checkout, 'checkout', '--quiet', '--force', 'HEAD');
    for (const path of textPaths) {
      assert.equal(readFileSync(join(checkout, path), 'utf8'), 'preserve\nthese bytes\n', `${autocrlf}: ${path}`);
    }
    for (const path of rawPaths) {
      assert.deepEqual(
        readFileSync(join(checkout, path)),
        path.endsWith('.dat') ? unknownBinary : raw,
        `${autocrlf}: ${path}`,
      );
    }
    // A renormalization must be a no-op, not an entire-file diff.
    git(checkout, 'add', '--renormalize', '.');
    assert.equal(git(checkout, 'status', '--porcelain'), '', `${autocrlf}: checkout/renormalization changed bytes`);
    console.log(`core.autocrlf=${autocrlf}: LF text and unchanged binary/artifact bytes verified`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
