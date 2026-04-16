import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveFailurePaths } from './log-reader';
import { FailureRecord } from './types';

const tempDirs: string[] = [];

function createFailure(file: string): FailureRecord {
  return {
    type: 'lint',
    file,
    line: 1,
    column: 1,
    message: 'example failure',
    rule: 'F401',
    rawLog: '',
    confidence: 0.95,
  };
}

function createGitRepo(files: string[]): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greencheck-log-reader-'));
  tempDirs.push(tempDir);

  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'greencheck-tests'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'greencheck-tests@example.com'], { cwd: tempDir, stdio: 'ignore' });

  for (const file of files) {
    const fullPath = path.join(tempDir, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, 'test\n', 'utf-8');
  }

  execFileSync('git', ['add', '.'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tempDir, stdio: 'ignore' });
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('resolveFailurePaths', () => {
  it('maps job-relative failure paths to repo-relative tracked files', () => {
    const repoDir = createGitRepo([
      'backend/api/routes.py',
      'backend/tests/test_example.py',
      'frontend/src/App.tsx',
    ]);

    const resolved = resolveFailurePaths(
      [
        createFailure('api/routes.py'),
        createFailure('tests/test_example.py'),
        createFailure('frontend/src/App.tsx'),
      ],
      repoDir,
    );

    expect(resolved.map((failure) => failure.file)).toEqual([
      'backend/api/routes.py',
      'backend/tests/test_example.py',
      'frontend/src/App.tsx',
    ]);
  });

  it('leaves unmatched paths unchanged', () => {
    const repoDir = createGitRepo(['backend/api/routes.py']);
    const [resolved] = resolveFailurePaths([createFailure('missing/file.py')], repoDir);

    expect(resolved.file).toBe('missing/file.py');
  });
});
