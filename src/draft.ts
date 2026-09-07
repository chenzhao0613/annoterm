import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {MarkdownBlock, PendingReview, ReviewBundle, ReviewComment} from './types.js';

export function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function reviewDirectory(cwd = process.cwd()): string {
  return path.join(cwd, '.tas', 'reviews');
}

export function pendingPath(reviewId: string, cwd = process.cwd()): string {
  return path.join(reviewDirectory(cwd), `${reviewId}.pending.json`);
}

export function submittedPath(reviewId: string, cwd = process.cwd()): string {
  return path.join(reviewDirectory(cwd), `${reviewId}.submitted.json`);
}

function atomicJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, filePath);
}

export function savePending(review: PendingReview, cwd = process.cwd()): string {
  const filePath = pendingPath(review.reviewId, cwd);
  atomicJson(filePath, review);
  return filePath;
}

export function buildBundle(options: {
  reviewId: string;
  filePath: string;
  fileHash: string;
  source: string;
  blocks: MarkdownBlock[];
  comments: ReviewComment[];
}): ReviewBundle {
  const blockById = new Map(options.blocks.map(block => [block.id, block]));
  const comments = [...options.comments]
    .sort((left, right) => {
      const leftBlock = blockById.get(left.blockId);
      const rightBlock = blockById.get(right.blockId);
      return (leftBlock?.source.startByte ?? 0) - (rightBlock?.source.startByte ?? 0);
    })
    .map(comment => {
      const block = blockById.get(comment.blockId);
      if (!block) throw new Error(`Comment target no longer exists: ${comment.blockId}`);
      const contextSize = 120;
      return {
        id: comment.id,
        target: {
          kind: block.kind,
          astPath: block.astPath,
          source: block.source,
          quote: {
            exact: block.exact,
            prefix: options.source.slice(Math.max(0, block.startOffset - contextSize), block.startOffset),
            suffix: options.source.slice(block.endOffset, block.endOffset + contextSize),
          },
          fingerprint: sha256(block.exact.trim().replace(/\s+/g, ' ')),
        },
        body: comment.body,
        createdAt: comment.createdAt,
      };
    });

  return {
    schemaVersion: 'tas.markdown-review/v1',
    reviewId: options.reviewId,
    state: 'submitted',
    file: {
      path: options.filePath,
      sha256: options.fileHash,
      reviewedAt: new Date().toISOString(),
    },
    comments,
    summary: {
      commentCount: comments.length,
      targetCount: new Set(options.comments.map(comment => comment.blockId)).size,
    },
  };
}

export function saveSubmitted(bundle: ReviewBundle, cwd = process.cwd()): string {
  const destination = submittedPath(bundle.reviewId, cwd);
  atomicJson(destination, bundle);
  rmSync(pendingPath(bundle.reviewId, cwd), {force: true});
  return destination;
}

export function listSubmittedBundles(cwd = process.cwd()): ReviewBundle[] {
  const directory = reviewDirectory(cwd);
  if (!existsSync(directory)) return [];
  const bundles: ReviewBundle[] = [];
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.submitted.json')) continue;
    const filePath = path.join(directory, file);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ReviewBundle;
    if (parsed.schemaVersion === 'tas.markdown-review/v1' && parsed.state === 'submitted') bundles.push(parsed);
  }
  return bundles.sort((left, right) => {
    const timeDifference = Date.parse(right.file.reviewedAt) - Date.parse(left.file.reviewedAt);
    return timeDifference || right.reviewId.localeCompare(left.reviewId);
  });
}

export function latestSubmittedBundle(cwd = process.cwd()): ReviewBundle | undefined {
  return listSubmittedBundles(cwd)[0];
}
