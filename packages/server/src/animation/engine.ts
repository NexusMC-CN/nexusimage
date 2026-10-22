import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { detectImageFormat, NexusImageError, throwIfAborted } from '@nexusmc-cn/nexusimage/contracts';
import type {
  AnimationTranscodeOptions,
  NodeAnimatedImage,
  NodeAnimationEngineApi,
  NodeImageSource,
} from '../types.js';
import { sourceSizeHint, toInputBuffer } from '../source/input.js';
import {
  assertAnimationBudget,
  resolveAnimationLimits,
  type AnimationResourceLimits,
  type ResolvedAnimationLimits,
} from './limits.js';
import { createAnimationCommand, createAnimationFilter } from './command.js';
import { createAlphaProbeCommand, parseAlphaProbeOutput } from './alpha.js';
import { parseFrameProbeOutput } from './probe.js';
import { runImageCommand } from './runner.js';
import { patchLastWebpFrameDuration } from './webp.js';

type AnimationFormat = 'gif' | 'webp' | 'avif';
type ProbeStage = 'decode' | 'encode';
type CommandRunner = typeof runImageCommand;

export interface FfmpegAnimationEngineOptions {
  /** Trusted host binary paths or command names. No shell is used. */
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  /** Host ceilings. Per-call options may only lower them. */
  readonly limits?: AnimationResourceLimits;
}

interface StreamInfo {
  readonly width: number;
  readonly height: number;
  readonly pixelFormat?: string;
  readonly videoOrdinal: number;
  readonly frameCountHint?: number;
}

interface AnimationProbe extends StreamInfo {
  readonly frameCount: number;
  readonly durationMs: number;
  readonly finalFrameDurationMs: number;
}

function malformedProbe(stage: ProbeStage, message: string): NexusImageError {
  return new NexusImageError(stage === 'decode' ? 'DECODE_FAILED' : 'ENCODE_FAILED', stage, message);
}

function parseStreamProbeOutput(output: string, format: AnimationFormat, stage: ProbeStage): StreamInfo {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines.length > 4) throw malformedProbe(stage, 'Invalid number of animation video streams.');
  const streams = lines.map((line, videoOrdinal): StreamInfo => {
    const parts = line.split('|');
    if (parts.shift() !== 'stream') throw malformedProbe(stage, 'Missing animation video stream.');
    const fields = new Map<string, string>();
    for (const part of parts) {
      const separator = part.indexOf('=');
      if (separator < 1) throw malformedProbe(stage, 'Malformed animation stream metadata.');
      const key = part.slice(0, separator);
      if (fields.has(key)) throw malformedProbe(stage, 'Duplicate animation stream metadata.');
      fields.set(key, part.slice(separator + 1));
    }
    const width = Number(fields.get('width'));
    const height = Number(fields.get('height'));
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0)
      throw malformedProbe(stage, 'Animation stream has invalid dimensions.');
    const rawFrameCount = fields.get('nb_frames');
    const frameCountHint = rawFrameCount === undefined || rawFrameCount === 'N/A' ? undefined : Number(rawFrameCount);
    if (frameCountHint !== undefined && (!Number.isSafeInteger(frameCountHint) || frameCountHint < 0))
      throw malformedProbe(stage, 'Animation stream has an invalid frame count.');
    return { width, height, pixelFormat: fields.get('pix_fmt'), videoOrdinal, frameCountHint };
  });
  if (format !== 'avif') {
    if (streams.length !== 1) throw malformedProbe(stage, 'Expected one animation video stream.');
    return streams[0]!;
  }
  const animated = streams.filter((stream) => (stream.frameCountHint ?? 0) > 1);
  if (animated.length > 1)
    throw new NexusImageError('UNSUPPORTED', 'capability', 'AVIF contains multiple animated video tracks.');
  if (animated.length === 1) return animated[0]!;
  if (streams.length === 1) return streams[0]!;
  throw malformedProbe(stage, 'Unable to identify the AVIF animation track.');
}

function probeArgs(path: string, format: AnimationFormat, frames: boolean, videoOrdinal = 0): string[] {
  const args = ['-v', 'error', '-select_streams', frames ? `v:${videoOrdinal}` : 'v'];
  if (format !== 'avif') args.push('-ignore_loop', '1', '-min_delay', '0', '-default_delay', '0');
  if (frames) {
    args.push(
      '-show_frames',
      '-show_entries',
      'frame=best_effort_timestamp_time,pts_time,duration_time,pkt_duration_time',
    );
  } else args.push('-show_entries', 'stream=index,width,height,pix_fmt,nb_frames');
  args.push('-of', 'compact=p=1:nk=0', path);
  return args;
}

function isUnavailableCapability(stderr: string): boolean {
  return /unknown (?:decoder|encoder)|(?:decoder|encoder) .* not found|unknown format|unable to find a suitable output format|unrecognized option|option .+ not found|no such filter|requested output format .* not a suitable output format/i.test(
    stderr,
  );
}

function expectedFormat(type: AnimationTranscodeOptions['type']): AnimationFormat {
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/avif') return 'avif';
  throw new NexusImageError('ENCODE_FAILED', 'encode', 'Unsupported animation output type.');
}

function assertInputBytes(size: number, limits: ResolvedAnimationLimits): void {
  if (size > limits.maxInputBytes) {
    throw new NexusImageError(
      'RESOURCE_LIMIT',
      'source',
      `Input bytes exceeds the configured resource limit (${limits.maxInputBytes}).`,
    );
  }
}

function assertOutputBytes(size: number, limits: ResolvedAnimationLimits): void {
  if (size > limits.maxOutputBytes) {
    throw new NexusImageError(
      'RESOURCE_LIMIT',
      'encode',
      `Encoded bytes exceeds the configured resource limit (${limits.maxOutputBytes}).`,
    );
  }
}

function assertTempDirectory(path: string): void {
  const parent = resolve(tmpdir());
  const actual = resolve(path);
  if (!actual.startsWith(parent + sep) || !actual.slice(parent.length + 1).startsWith('nexusimage-ffmpeg-')) {
    throw new NexusImageError(
      'UNSUPPORTED',
      'capability',
      'The temporary image directory is outside the system temp path.',
    );
  }
}

/** Optional external-process backend for multi-frame image transcoding. */
export class FfmpegAnimationEngine implements NodeAnimationEngineApi {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly hostLimits?: AnimationResourceLimits;

  constructor(
    options: FfmpegAnimationEngineOptions = {},
    private readonly run: CommandRunner = runImageCommand,
  ) {
    if (options.ffmpegPath !== undefined && (!options.ffmpegPath || typeof options.ffmpegPath !== 'string'))
      throw new NexusImageError('INVALID_SOURCE', 'source', 'ffmpegPath must be a nonempty command or path.');
    if (options.ffprobePath !== undefined && (!options.ffprobePath || typeof options.ffprobePath !== 'string'))
      throw new NexusImageError('INVALID_SOURCE', 'source', 'ffprobePath must be a nonempty command or path.');
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.hostLimits = options.limits;
    resolveAnimationLimits(this.hostLimits);
  }

  private async probe(
    path: string,
    format: AnimationFormat,
    stage: ProbeStage,
    limits: ResolvedAnimationLimits,
    deadlineAt: number,
    signal?: AbortSignal,
  ): Promise<AnimationProbe> {
    const common = {
      stage,
      deadlineAt,
      signal,
      maxStdoutBytes: Math.min(8 * 1024 * 1024, Math.max(64 * 1024, limits.maxFrames * 256)),
      maxStderrBytes: 64 * 1024,
    } as const;
    const stream = await this.run(this.ffprobePath, probeArgs(path, format, false), common);
    if (stream.code !== 0) {
      if (isUnavailableCapability(stream.stderr))
        throw new NexusImageError('UNSUPPORTED', 'capability', 'The configured FFprobe cannot read this image format.');
      throw malformedProbe(stage, 'FFprobe could not read the animation video stream.');
    }
    const streamInfo = parseStreamProbeOutput(stream.stdout, format, stage);
    if (streamInfo.frameCountHint !== undefined && streamInfo.frameCountHint > limits.maxFrames)
      throw new NexusImageError('RESOURCE_LIMIT', stage, 'Animation exceeds the frame limit.');
    assertAnimationBudget({ ...streamInfo, frameCount: 1, durationMs: 0 }, limits, stage);
    const frames = await this.run(this.ffprobePath, probeArgs(path, format, true, streamInfo.videoOrdinal), {
      ...common,
      maxFrameLines: limits.maxFrames,
    });
    if (frames.code !== 0) {
      if (isUnavailableCapability(frames.stderr))
        throw new NexusImageError(
          'UNSUPPORTED',
          'capability',
          'The configured FFprobe cannot decode this image format.',
        );
      throw malformedProbe(stage, 'FFprobe could not decode the animation frames.');
    }
    const timing = parseFrameProbeOutput(frames.stdout, stage, limits.maxFrames, limits.maxDurationMs);
    const probed = { ...streamInfo, ...timing };
    assertAnimationBudget(probed, limits, stage);
    return probed;
  }

  async transcodeAnimation(source: NodeImageSource, options: AnimationTranscodeOptions): Promise<NodeAnimatedImage> {
    if (!options || typeof options !== 'object')
      throw new NexusImageError('ENCODE_FAILED', 'encode', 'Animation options are required.');
    const outputFormat = expectedFormat(options.type);
    throwIfAborted(options.signal, 'source');
    const limits = resolveAnimationLimits(this.hostLimits, options.limits);
    const sizeHint = sourceSizeHint(source);
    if (sizeHint !== undefined) assertInputBytes(sizeHint, limits);
    const { buffer } = await toInputBuffer(source, options.signal);
    if (buffer.byteLength === 0) throw new NexusImageError('INVALID_SOURCE', 'source', 'Image source is empty.');
    assertInputBytes(buffer.byteLength, limits);
    const inputFormat = detectImageFormat(buffer).format;
    if (inputFormat !== 'gif' && inputFormat !== 'webp' && inputFormat !== 'avif')
      throw new NexusImageError('INVALID_SOURCE', 'source', 'Animated GIF, WebP, or AVIF input is required.');
    throwIfAborted(options.signal, 'source');

    let directory: string;
    try {
      directory = await mkdtemp(join(tmpdir(), 'nexusimage-ffmpeg-'));
    } catch (error) {
      throw new NexusImageError('DECODE_FAILED', 'decode', 'Unable to create a temporary animation directory.', error);
    }
    assertTempDirectory(directory);
    const inputPath = join(directory, `input.${inputFormat}`);
    const outputPath = join(directory, `output.${outputFormat}`);
    let operationFailed = false;
    try {
      try {
        await writeFile(inputPath, buffer, { mode: 0o600 });
      } catch (error) {
        throw new NexusImageError('DECODE_FAILED', 'decode', 'Unable to stage the animation input.', error);
      }
      const deadlineAt = Date.now() + limits.maxProcessingMs;
      const sourceInfo = await this.probe(inputPath, inputFormat, 'decode', limits, deadlineAt, options.signal);
      if (sourceInfo.frameCount < 2)
        throw new NexusImageError('INVALID_SOURCE', 'source', 'Animation input must contain at least two frames.');
      const plan = createAnimationFilter(options, sourceInfo);
      if (plan.scaleCanvas) {
        assertAnimationBudget(
          { ...plan.scaleCanvas, frameCount: sourceInfo.frameCount, durationMs: sourceInfo.durationMs },
          limits,
          'encode',
        );
      }
      assertAnimationBudget(
        {
          width: plan.width,
          height: plan.height,
          frameCount: sourceInfo.frameCount,
          durationMs: sourceInfo.durationMs,
        },
        limits,
        'encode',
      );
      if (outputFormat === 'avif') {
        const alphaProbe = await this.run(
          this.ffmpegPath,
          createAlphaProbeCommand(inputPath, inputFormat, sourceInfo.videoOrdinal, sourceInfo.frameCount),
          {
            stage: 'decode',
            deadlineAt,
            signal: options.signal,
            maxStdoutBytes: Math.min(8 * 1024 * 1024, Math.max(64 * 1024, sourceInfo.frameCount * 128)),
            maxStderrBytes: 64 * 1024,
            maxFrameLines: limits.maxFrames,
          },
        );
        if (alphaProbe.code !== 0) {
          if (isUnavailableCapability(alphaProbe.stderr))
            throw new NexusImageError('UNSUPPORTED', 'capability', 'FFmpeg cannot inspect animation transparency.');
          throw new NexusImageError('DECODE_FAILED', 'decode', 'FFmpeg could not inspect animation transparency.');
        }
        if (parseAlphaProbeOutput(alphaProbe.stdout, sourceInfo.frameCount)) {
          throw new NexusImageError('UNSUPPORTED', 'capability', 'Animated AVIF alpha encoding is unavailable.');
        }
      }
      const args = createAnimationCommand(
        inputPath,
        outputPath,
        inputFormat,
        sourceInfo.frameCount,
        sourceInfo.finalFrameDurationMs,
        options,
        plan.filter,
        limits.maxOutputBytes,
        sourceInfo.videoOrdinal,
      );
      const command = await this.run(this.ffmpegPath, args, {
        stage: 'encode',
        deadlineAt,
        signal: options.signal,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 64 * 1024,
        outputPath,
        maxOutputBytes: limits.maxOutputBytes,
      });
      if (command.code !== 0) {
        if (isUnavailableCapability(command.stderr))
          throw new NexusImageError(
            'UNSUPPORTED',
            'capability',
            'The configured FFmpeg cannot encode the output format.',
          );
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'FFmpeg could not encode the animation.');
      }
      let outputSize: number;
      try {
        outputSize = (await stat(outputPath)).size;
      } catch (error) {
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'FFmpeg produced no animation output.', error);
      }
      assertOutputBytes(outputSize, limits);
      let encoded: Buffer;
      try {
        encoded = await readFile(outputPath);
      } catch (error) {
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'Unable to read the encoded animation.', error);
      }
      assertOutputBytes(encoded.byteLength, limits);
      if (outputFormat === 'webp') {
        encoded = patchLastWebpFrameDuration(encoded, sourceInfo.frameCount, sourceInfo.finalFrameDurationMs);
        throwIfAborted(options.signal, 'encode');
        try {
          await writeFile(outputPath, encoded);
        } catch (error) {
          throw new NexusImageError('ENCODE_FAILED', 'encode', 'Unable to finalize WebP frame timing.', error);
        }
      }
      const resultInfo = await this.probe(outputPath, outputFormat, 'encode', limits, deadlineAt, options.signal);
      if (resultInfo.frameCount !== sourceInfo.frameCount) {
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'FFmpeg changed the animation frame count.');
      }
      if (resultInfo.width !== plan.width || resultInfo.height !== plan.height)
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'FFmpeg produced unexpected animation dimensions.');
      const timingToleranceMs = Math.max(2, sourceInfo.frameCount * (outputFormat === 'gif' ? 5 : 1));
      if (Math.abs(resultInfo.durationMs - sourceInfo.durationMs) > timingToleranceMs)
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'FFmpeg changed the animation duration.');
      throwIfAborted(options.signal, 'encode');
      if (detectImageFormat(encoded).format !== outputFormat)
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'FFmpeg produced a different image format.');
      return {
        buffer: encoded,
        type: options.type,
        width: resultInfo.width,
        height: resultInfo.height,
        frameCount: resultInfo.frameCount,
        durationMs: resultInfo.durationMs,
      };
    } catch (error) {
      operationFailed = true;
      throw error;
    } finally {
      try {
        assertTempDirectory(directory);
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        if (!operationFailed)
          throw new NexusImageError('ENCODE_FAILED', 'encode', 'Unable to clean up temporary animation files.', error);
      }
    }
  }
}

export function createFfmpegAnimationEngine(options?: FfmpegAnimationEngineOptions): FfmpegAnimationEngine {
  return new FfmpegAnimationEngine(options);
}
