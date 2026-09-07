#!/usr/bin/env node
import {render} from 'ink';
import {randomUUID} from 'node:crypto';
import {closeSync, mkdirSync, openSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {ReadStream as TtyReadStream, WriteStream as TtyWriteStream} from 'node:tty';
import {parseMarkdown} from './markdown.js';
import {
  buildBundle,
  latestSubmittedBundle,
  listSubmittedBundles,
  savePending,
  saveSubmitted,
  sha256,
} from './draft.js';
import {feedbackPrompt} from './feedback.js';
import {acquireReviewLock, ReviewLockedError} from './lock.js';
import {ReviewApp} from './tui.js';
import type {PendingReview, ReviewBundle, ReviewComment} from './types.js';

type OutputFormat = 'human' | 'json' | 'prompt';
type TerminalIo = {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  close: () => void;
};

class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

function usage(): never {
  process.stderr.write(`Usage:
  annoterm review <markdown-file> [--format human|json|prompt] [--output <file>]
  annoterm feedback latest [--format human|json|prompt]
  annoterm feedback list [--format human|json|prompt]
  annoterm feedback wait [--format human|json|prompt] [--timeout <milliseconds>]

Review keys:
  j/k or arrows  navigate blocks
  c              comment on focused block
  e              inspect/delete pending comments
  S              finish and submit review
  q              save pending review and exit
`);
  throw new CliError('', 64);
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function outputFormat(args: string[], fallback: OutputFormat): OutputFormat {
  const value = argumentValue(args, '--format') ?? fallback;
  if (value !== 'human' && value !== 'json' && value !== 'prompt') {
    throw new CliError(`Unsupported output format: ${value}`, 64);
  }
  return value;
}

function terminalPaths(): {input: string; output: string} {
  return process.platform === 'win32'
    ? {input: '\\\\.\\CONIN$', output: '\\\\.\\CONOUT$'}
    : {input: '/dev/tty', output: '/dev/tty'};
}

function openTerminal(): TerminalIo {
  if (process.stdin.isTTY && process.stderr.isTTY) {
    return {input: process.stdin, output: process.stderr, close: () => {}};
  }

  const names = terminalPaths();
  let inputFd: number | undefined;
  let outputFd: number | undefined;
  try {
    inputFd = openSync(names.input, 'r');
    outputFd = openSync(names.output, 'w');
    const input = new TtyReadStream(inputFd);
    const output = new TtyWriteStream(outputFd);
    let closed = false;
    return {
      input,
      output,
      close: () => {
        if (closed) return;
        closed = true;
        input.destroy();
        output.destroy();
      },
    };
  } catch {
    if (inputFd !== undefined) try { closeSync(inputFd); } catch {}
    if (outputFd !== undefined) try { closeSync(outputFd); } catch {}
    throw new CliError(
      'Interactive review needs a controlling terminal. Run Annoterm in a terminal, or have the agent invoke it from an interactive session.',
      69,
    );
  }
}

function serializeBundle(bundle: ReviewBundle, format: OutputFormat): string {
  if (format === 'json') return `${JSON.stringify(bundle, null, 2)}\n`;
  if (format === 'prompt') return `${feedbackPrompt(bundle)}\n`;
  return `Review ${bundle.reviewId}: ${bundle.summary.commentCount} comment(s) on ${bundle.file.path}\n`;
}

function writeResult(value: string, outputPath?: string): void {
  if (!outputPath) {
    process.stdout.write(value);
    return;
  }
  const destination = path.resolve(outputPath);
  mkdirSync(path.dirname(destination), {recursive: true});
  writeFileSync(destination, value, 'utf8');
  process.stderr.write(`Feedback written to ${destination}\n`);
}

async function reviewCommand(args: string[]): Promise<void> {
  const requestedPath = args[0];
  if (!requestedPath || requestedPath.startsWith('--')) usage();
  const absolutePath = path.resolve(requestedPath.replace(/^@/, ''));
  const outputPath = argumentValue(args, '--output');
  const format = outputFormat(args, outputPath || !process.stdout.isTTY ? 'json' : 'human');
  let source: string;
  try {
    source = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new CliError(`Cannot read ${requestedPath}: ${error instanceof Error ? error.message : String(error)}`, 66);
  }
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) throw new CliError('The Markdown file has no reviewable blocks.', 66);

  const lock = acquireReviewLock({filePath: requestedPath});
  let terminal: TerminalIo;
  try {
    terminal = openTerminal();
  } catch (error) {
    lock.release();
    throw error;
  }
  const reviewId = `review_${randomUUID()}`;
  const fileHash = sha256(source);
  let submittedComments: ReviewComment[] | undefined;
  let cancelled = false;

  const draftFor = (comments: ReviewComment[]): PendingReview => ({
    schemaVersion: 'annoterm.markdown-review-draft/v1',
    reviewId,
    state: 'collecting',
    file: {path: requestedPath, sha256: fileHash, source},
    comments,
    updatedAt: new Date().toISOString(),
  });

  const initialDraftPath = savePending(draftFor([]));
  terminal.output.write('\u001b[?1049h\u001b[2J\u001b[H');

  try {
    const app = render(
      <ReviewApp
        fileName={path.basename(requestedPath)}
        blocks={blocks}
        onCommentsChanged={comments => savePending(draftFor(comments))}
        onSubmit={comments => {
          submittedComments = comments;
        }}
        onCancel={() => {
          cancelled = true;
        }}
      />,
      {
        stdin: terminal.input,
        stdout: terminal.output,
        stderr: terminal.output,
        exitOnCtrlC: true,
        patchConsole: false,
      },
    );
    await app.waitUntilExit();
  } finally {
    terminal.output.write('\u001b[?1049l');
    terminal.close();
    lock.release();
  }

  if (!submittedComments) {
    process.stderr.write(`Review saved without submission: ${initialDraftPath}\n`);
    throw new CliError('', cancelled ? 2 : 130);
  }

  const bundle = buildBundle({
    reviewId,
    filePath: requestedPath,
    fileHash,
    source,
    blocks,
    comments: submittedComments,
  });
  const savedPath = saveSubmitted(bundle);
  writeResult(serializeBundle(bundle, format), outputPath);
  if (format === 'human' && !outputPath) process.stderr.write(`Full bundle saved to ${savedPath}\n`);
}

function listValue(bundles: ReviewBundle[], format: OutputFormat): string {
  if (format === 'json') {
    return `${JSON.stringify({schemaVersion: 'annoterm.feedback-list/v1', reviews: bundles}, null, 2)}\n`;
  }
  if (format === 'prompt') return bundles.map(feedbackPrompt).join('\n\n---\n\n') + (bundles.length ? '\n' : '');
  if (bundles.length === 0) return 'No submitted reviews.\n';
  return bundles
    .map(bundle => `${bundle.reviewId}  ${bundle.file.reviewedAt}  ${bundle.summary.commentCount} comment(s)  ${bundle.file.path}`)
    .join('\n') + '\n';
}

async function feedbackCommand(args: string[]): Promise<void> {
  const action = args[0];
  if (!action) usage();
  const format = outputFormat(args, process.stdout.isTTY ? 'human' : 'json');

  if (action === 'list') {
    process.stdout.write(listValue(listSubmittedBundles(), format));
    return;
  }

  if (action === 'latest') {
    const bundle = latestSubmittedBundle();
    if (!bundle) throw new CliError('No submitted reviews found.', 4);
    process.stdout.write(serializeBundle(bundle, format));
    return;
  }

  if (action === 'wait') {
    const timeoutValue = argumentValue(args, '--timeout');
    const timeout = timeoutValue === undefined ? 0 : Number(timeoutValue);
    if (!Number.isFinite(timeout) || timeout < 0) throw new CliError('--timeout must be a non-negative number.', 64);
    const seen = new Set(listSubmittedBundles().map(bundle => bundle.reviewId));
    const startedAt = Date.now();
    while (true) {
      const next = listSubmittedBundles().find(bundle => !seen.has(bundle.reviewId));
      if (next) {
        process.stdout.write(serializeBundle(next, format));
        return;
      }
      if (timeout > 0 && Date.now() - startedAt >= timeout) {
        throw new CliError('Timed out waiting for submitted feedback.', 124);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  usage();
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'review') return reviewCommand(args);
  if (command === 'feedback') return feedbackCommand(args);
  usage();
}

main().catch(error => {
  const cliError = error instanceof CliError
    ? error
    : error instanceof ReviewLockedError
      ? new CliError(error.message, error.exitCode)
      : new CliError(error instanceof Error ? error.message : String(error));
  if (cliError.message) process.stderr.write(`annoterm: ${cliError.message}\n`);
  process.exitCode = cliError.exitCode;
});
