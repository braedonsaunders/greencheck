import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
}));

vi.mock('@actions/exec', () => ({
  exec: mocks.exec,
}));

vi.mock('@actions/core', () => ({
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

import { pushChanges } from './git-ops';

interface GitCall {
  args: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

describe('pushChanges', () => {
  beforeEach(() => {
    mocks.exec.mockReset();
  });

  it('clears checkout credentials before pushing with trigger-token and restores them afterward', async () => {
    const assertAllCallsUsed = queueGitCalls([
      {
        args: ['remote', 'get-url', 'origin'],
        stdout: 'https://github.com/owner/repo.git',
      },
      {
        args: ['config', '--local', '--get-all', 'http.https://github.com/.extraheader'],
        stdout: 'AUTHORIZATION: basic checkout-token',
      },
      {
        args: ['remote', 'set-url', 'origin', 'https://x-access-token:trigger-token@github.com/owner/repo.git'],
      },
      {
        args: ['config', '--local', '--unset-all', 'http.https://github.com/.extraheader'],
      },
      {
        args: ['push', 'origin', 'HEAD:main'],
      },
      {
        args: ['remote', 'set-url', 'origin', 'https://github.com/owner/repo.git'],
      },
      {
        args: ['config', '--local', '--add', 'http.https://github.com/.extraheader', 'AUTHORIZATION: basic checkout-token'],
      },
    ]);

    const pushed = await pushChanges('main', 'trigger-token', 'owner', 'repo');

    expect(pushed).toBe(true);
    assertAllCallsUsed();
  });

  it('fails the push when checkout credentials cannot be cleared', async () => {
    const assertAllCallsUsed = queueGitCalls([
      {
        args: ['remote', 'get-url', 'origin'],
        stdout: 'https://github.com/owner/repo.git',
      },
      {
        args: ['config', '--local', '--get-all', 'http.https://github.com/.extraheader'],
        stdout: 'AUTHORIZATION: basic checkout-token',
      },
      {
        args: ['remote', 'set-url', 'origin', 'https://x-access-token:trigger-token@github.com/owner/repo.git'],
      },
      {
        args: ['config', '--local', '--unset-all', 'http.https://github.com/.extraheader'],
        exitCode: 5,
        stderr: 'unset failed',
      },
      {
        args: ['remote', 'set-url', 'origin', 'https://github.com/owner/repo.git'],
      },
    ]);

    const pushed = await pushChanges('main', 'trigger-token', 'owner', 'repo');

    expect(pushed).toBe(false);
    assertAllCallsUsed();
  });
});

function queueGitCalls(calls: GitCall[]): () => void {
  let index = 0;

  mocks.exec.mockImplementation(async (_command, args, options) => {
    const call = calls[index++];
    if (!call) {
      throw new Error(`Unexpected git call: ${JSON.stringify(args)}`);
    }

    expect(args).toEqual(call.args);

    if (call.stdout) {
      options.listeners.stdout(Buffer.from(call.stdout));
    }
    if (call.stderr) {
      options.listeners.stderr(Buffer.from(call.stderr));
    }

    return call.exitCode ?? 0;
  });

  return () => {
    expect(index).toBe(calls.length);
  };
}
