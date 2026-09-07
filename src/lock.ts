import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

export class ReviewLockedError extends Error {
  readonly exitCode = 75;
}

export interface ReviewLock {
  release: () => void;
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function acquireReviewLock(options: {
  cwd?: string;
  filePath: string;
}): ReviewLock {
  const cwd = options.cwd ?? process.cwd();
  const locksDirectory = path.join(cwd, '.annoterm', 'locks');
  const lockPath = path.join(locksDirectory, 'review.lock');
  const ownerPath = path.join(lockPath, 'owner.json');
  mkdirSync(locksDirectory, {recursive: true});

  const tryAcquire = (): boolean => {
    try {
      mkdirSync(lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return false;
    }
  };

  if (!tryAcquire()) {
    let owner: {pid?: number; filePath?: string; startedAt?: string} = {};
    try {
      owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as typeof owner;
    } catch {}

    if (owner.pid && processIsRunning(owner.pid)) {
      throw new ReviewLockedError(
        `Another review is active${owner.filePath ? ` for ${owner.filePath}` : ''} (PID ${owner.pid}).`,
      );
    }

    // The owner no longer exists, so the atomic lock directory is stale.
    rmSync(lockPath, {recursive: true, force: true});
    if (!tryAcquire()) throw new ReviewLockedError('Another review started concurrently.');
  }

  writeFileSync(
    ownerPath,
    `${JSON.stringify({pid: process.pid, filePath: options.filePath, startedAt: new Date().toISOString()}, null, 2)}\n`,
    {encoding: 'utf8', mode: 0o600},
  );

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    rmSync(lockPath, {recursive: true, force: true});
  };
  process.once('exit', release);

  return {
    release: () => {
      process.removeListener('exit', release);
      release();
    },
  };
}
