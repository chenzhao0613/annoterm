import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {acquireReviewLock, ReviewLockedError} from './lock.js';

test('review lock prevents overlapping sessions and releases cleanly', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'tas-lock-'));
  try {
    const lockPath = path.join(cwd, '.tas', 'locks', 'review.lock');
    const lock = acquireReviewLock({cwd, filePath: 'PLAN.md'});
    assert.equal(existsSync(lockPath), true);
    assert.throws(
      () => acquireReviewLock({cwd, filePath: 'OTHER.md'}),
      (error: unknown) => error instanceof ReviewLockedError && error.exitCode === 75,
    );
    lock.release();
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
});

test('review lock recovers an abandoned owner', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'tas-stale-lock-'));
  try {
    const lockDirectory = path.join(cwd, '.tas', 'locks', 'review.lock');
    mkdirSync(lockDirectory, {recursive: true});
    writeFileSync(path.join(lockDirectory, 'owner.json'), JSON.stringify({pid: 2_147_483_647}));
    const lock = acquireReviewLock({cwd, filePath: 'PLAN.md'});
    assert.equal(existsSync(lockDirectory), true);
    lock.release();
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
});
