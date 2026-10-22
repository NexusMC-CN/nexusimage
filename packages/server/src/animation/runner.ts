import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { NexusImageError, throwIfAborted } from '@nexusmc-cn/nexusimage/contracts';

export interface ImageCommandOptions {
  readonly stage: 'decode' | 'encode';
  /** Absolute wall-clock deadline shared by every subprocess in one request. */
  readonly deadlineAt: number;
  readonly signal?: AbortSignal;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxFrameLines?: number;
  readonly outputPath?: string;
  readonly maxOutputBytes?: number;
}

export interface ImageCommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function outputSize(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

/** Run a trusted host executable without a shell, with hard lifetime and pipe limits. */
export function runImageCommand(
  executable: string,
  args: readonly string[],
  options: ImageCommandOptions,
): Promise<ImageCommandResult> {
  const { stage, signal } = options;
  throwIfAborted(signal, stage);
  const remainingMs = options.deadlineAt - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new NexusImageError('RESOURCE_LIMIT', stage, 'Animation processing time limit exceeded.');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let pendingLine = '';
    let frameLines = 0;
    let failure: NexusImageError | undefined;
    let finished = false;

    const fail = (error: NexusImageError) => {
      if (failure || finished) return;
      failure = error;
      child.kill();
    };
    const overOutputLimit = () => {
      if (!options.outputPath || options.maxOutputBytes === undefined || failure) return;
      try {
        if (outputSize(options.outputPath) > options.maxOutputBytes) {
          fail(new NexusImageError('RESOURCE_LIMIT', stage, 'Encoded bytes exceeds the configured resource limit.'));
        }
      } catch (error) {
        fail(new NexusImageError('ENCODE_FAILED', stage, 'Unable to inspect the animation output file.', error));
      }
    };
    const timeout = setTimeout(
      () => fail(new NexusImageError('RESOURCE_LIMIT', stage, 'Animation processing time limit exceeded.')),
      Math.min(Math.ceil(remainingMs), 2_147_483_647),
    );
    const sizeMonitor = options.outputPath ? setInterval(overOutputLimit, 50) : undefined;
    const onAbort = () =>
      fail(new NexusImageError('ABORTED', stage, 'The image operation was aborted.', signal?.reason));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > options.maxStdoutBytes) {
        fail(new NexusImageError('RESOURCE_LIMIT', stage, 'Frame probe output exceeds the configured limit.'));
        return;
      }
      stdoutChunks.push(chunk);
      if (options.maxFrameLines === undefined) return;
      const text = pendingLine + chunk.toString('utf8');
      const lines = text.split('\n');
      pendingLine = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('frame|') || /^frame:\d+\s/.test(line)) frameLines += 1;
        if (frameLines > options.maxFrameLines) {
          fail(new NexusImageError('RESOURCE_LIMIT', stage, 'Animation exceeds the frame limit.'));
          return;
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (failure) return;
      stderrBytes += chunk.byteLength;
      if (stderrBytes > options.maxStderrBytes) {
        fail(
          new NexusImageError('RESOURCE_LIMIT', stage, 'Image command diagnostic output exceeds the configured limit.'),
        );
        return;
      }
      stderrChunks.push(chunk);
    });
    child.on('error', (error) => {
      fail(new NexusImageError('UNSUPPORTED', 'capability', 'The configured image command is unavailable.', error));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (sizeMonitor) clearInterval(sizeMonitor);
      signal?.removeEventListener('abort', onAbort);
      overOutputLimit();
      finished = true;
      if (failure) {
        reject(failure);
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
        stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8'),
      });
    });
  });
}
