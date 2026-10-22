import { mkdtemp, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runImageCommand } from '../../src/animation/runner.js';

function runNode(script: string, options: Partial<Parameters<typeof runImageCommand>[2]> = {}) {
  return runImageCommand(process.execPath, ['-e', script], {
    stage: 'decode',
    deadlineAt: Date.now() + 5_000,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
    ...options,
  });
}

describe('FFmpeg subprocess runner', () => {
  it('captures bounded output and preserves nonzero exit status for the caller', async () => {
    const result = await runNode("process.stdout.write('frames'); process.stderr.write('problem'); process.exit(7)");
    expect(result).toEqual({ code: 7, stdout: 'frames', stderr: 'problem' });
  });

  it('reports an unavailable executable as a capability failure', async () => {
    await expect(
      runImageCommand('nexusimage-command-that-does-not-exist', [], {
        stage: 'decode',
        deadlineAt: Date.now() + 1_000,
        maxStdoutBytes: 1_024,
        maxStderrBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED', stage: 'capability' });
  });

  it('kills a process whose probe output exceeds its byte budget', async () => {
    await expect(runNode("process.stdout.write('x'.repeat(2048))", { maxStdoutBytes: 256 })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'decode',
    });
  });

  it('stops at the frame count ceiling without buffering the whole probe', async () => {
    await expect(
      runNode("process.stdout.write('frame|pts_time=0.0\\nframe|pts_time=0.1\\nframe|pts_time=0.2\\n')", {
        maxFrameLines: 2,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'decode' });
  });

  it('also counts metadata frame headers from the alpha probe', async () => {
    await expect(
      runNode("process.stdout.write('frame:0    pts:0\\nframe:1    pts:1\\nframe:2    pts:2\\n')", {
        maxFrameLines: 2,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'decode' });
  });

  it('terminates a process when the shared deadline expires', async () => {
    await expect(runNode('setTimeout(() => {}, 5000)', { deadlineAt: Date.now() + 50 })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'decode',
    });
  });

  it('terminates a process on caller cancellation', async () => {
    const controller = new AbortController();
    const running = runNode('setTimeout(() => {}, 5000)', { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(running).rejects.toMatchObject({ code: 'ABORTED', stage: 'decode' });
  });

  it('rejects an output that exceeds the file byte ceiling after command exit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexusimage-runner-test-'));
    const outputPath = join(directory, 'result.bin');
    try {
      await expect(
        runImageCommand(
          process.execPath,
          ['-e', "require('node:fs').writeFileSync(process.argv[1], Buffer.alloc(1024))", outputPath],
          {
            stage: 'encode',
            deadlineAt: Date.now() + 5_000,
            maxStdoutBytes: 1_024,
            maxStderrBytes: 1_024,
            outputPath,
            maxOutputBytes: 256,
          },
        ),
      ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'encode' });
    } finally {
      await unlink(outputPath).catch(() => undefined);
      await rmdir(directory);
    }
  });
});
