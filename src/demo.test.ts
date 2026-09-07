import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {buildBundle, latestSubmittedBundle, listSubmittedBundles, saveSubmitted, sha256} from './draft.js';
import {parseMarkdown} from './markdown.js';

test('parses semantic Markdown blocks with source positions', () => {
  const source = '# Plan\n\n1. First item\n2. Second item\n\n> Check this\n';
  const blocks = parseMarkdown(source);
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'listItem', 'listItem', 'blockquote']);
  assert.equal(blocks[1]?.source.startLine, 3);
  assert.equal(blocks[1]?.exact, '1. First item');
});

test('reports UTF-8 byte offsets while retaining correct Unicode quotes', () => {
  const source = '# Café ☕\n\nComment here.\n';
  const blocks = parseMarkdown(source);
  const paragraph = blocks[1]!;
  assert.equal(paragraph.source.startByte, Buffer.byteLength('# Café ☕\n\n', 'utf8'));
  assert.equal(paragraph.exact, 'Comment here.');
});

test('builds an ordered contextual review bundle', () => {
  const source = '# Plan\n\n- Alpha\n- Beta\n';
  const blocks = parseMarkdown(source);
  const beta = blocks.find(block => block.text === 'Beta')!;
  const bundle = buildBundle({
    reviewId: 'review_test',
    filePath: 'PLAN.md',
    fileHash: sha256(source),
    source,
    blocks,
    comments: [{id: 'comment_test', blockId: beta.id, body: 'Clarify this.', createdAt: '2026-01-01T00:00:00Z'}],
  });
  assert.equal(bundle.comments[0]?.target.quote.exact, '- Beta');
  assert.equal(bundle.comments[0]?.target.source.startLine, 4);
  assert.equal(bundle.summary.commentCount, 1);
  assert.equal(bundle.summary.targetCount, 1);
});

test('lists submitted feedback newest first and returns latest', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'annoterm-feedback-'));
  const source = '# Plan\n';
  const blocks = parseMarkdown(source);
  try {
    const older = buildBundle({reviewId: 'review_old', filePath: 'OLD.md', fileHash: sha256(source), source, blocks, comments: []});
    older.file.reviewedAt = '2026-01-01T00:00:00Z';
    const newer = buildBundle({reviewId: 'review_new', filePath: 'NEW.md', fileHash: sha256(source), source, blocks, comments: []});
    newer.file.reviewedAt = '2026-01-02T00:00:00Z';
    saveSubmitted(older, cwd);
    saveSubmitted(newer, cwd);
    assert.deepEqual(listSubmittedBundles(cwd).map(bundle => bundle.reviewId), ['review_new', 'review_old']);
    assert.equal(latestSubmittedBundle(cwd)?.reviewId, 'review_new');
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
});
