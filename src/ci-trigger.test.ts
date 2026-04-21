import { describe, expect, it, vi } from 'vitest';
import { waitForWorkflowCompletion } from './ci-trigger';

function createRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 101,
    workflow_id: 230872278,
    name: 'CI',
    head_branch: 'main',
    head_sha: 'abc123def456',
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://github.com/example/repo/actions/runs/101',
    event: 'push',
    pull_requests: [],
    ...overrides,
  };
}

function createOctokit(runResponses: Array<Record<string, unknown>[]>) {
  let index = 0;

  return {
    rest: {
      actions: {
        listWorkflowRunsForRepo: vi.fn(async () => ({
          data: {
            workflow_runs: runResponses[Math.min(index++, runResponses.length - 1)] || [],
          },
        })),
        createWorkflowDispatch: vi.fn(async () => undefined),
      },
    },
  };
}

describe('waitForWorkflowCompletion', () => {
  it('dispatches the watched workflow when no follow-up runs appear for the pushed sha', async () => {
    const readOctokit = createOctokit([
      [],
      [],
      [createRun()],
    ]);
    const triggerOctokit = createOctokit([[createRun()]]);

    const result = await waitForWorkflowCompletion(
      readOctokit as never,
      'owner',
      'repo',
      'main',
      'abc123def456',
      {
        timeoutMs: 50,
        cooldownMs: 0,
        pollIntervalMs: 0,
        dispatchWorkflowId: 230872278,
        dispatchOctokit: triggerOctokit as never,
        emptyPollsBeforeDispatch: 2,
      },
    );

    expect(triggerOctokit.rest.actions.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 230872278,
      ref: 'main',
    });
    expect(result?.id).toBe(101);
    expect(result?.workflowId).toBe(230872278);
  });

  it('returns a completed run without dispatching when GitHub Actions finds it on its own', async () => {
    const readOctokit = createOctokit([
      [],
      [createRun({ id: 202, conclusion: 'failure' })],
    ]);
    const triggerOctokit = createOctokit([[createRun()]]);

    const result = await waitForWorkflowCompletion(
      readOctokit as never,
      'owner',
      'repo',
      'main',
      'abc123def456',
      {
        timeoutMs: 50,
        cooldownMs: 0,
        pollIntervalMs: 0,
        dispatchWorkflowId: 230872278,
        dispatchOctokit: triggerOctokit as never,
        emptyPollsBeforeDispatch: 3,
      },
    );

    expect(triggerOctokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    expect(result?.id).toBe(202);
    expect(result?.conclusion).toBe('failure');
  });
});
