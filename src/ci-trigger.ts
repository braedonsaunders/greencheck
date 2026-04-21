import * as core from '@actions/core';
import * as github from '@actions/github';
import { CIWorkflowRun } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;
type WorkflowRunApiRecord = any;
type PullRequestApiRecord = any;

interface WorkflowWaitOptions {
  timeoutMs?: number;
  cooldownMs?: number;
  pollIntervalMs?: number;
  dispatchWorkflowId?: string | number | null;
  dispatchOctokit?: Octokit;
  emptyPollsBeforeDispatch?: number;
}

export async function rerunFailedJobs(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<boolean> {
  try {
    await octokit.rest.actions.reRunWorkflowFailedJobs({
      owner,
      repo,
      run_id: runId,
    });
    core.info(`Re-triggered failed jobs for run ${runId}`);
    return true;
  } catch (error) {
    core.warning(`Failed to re-run failed jobs: ${error}`);
    return false;
  }
}

export async function triggerWorkflowDispatch(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string | number,
  branch: string,
): Promise<boolean> {
  try {
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref: branch,
    });
    core.info(`Dispatched workflow ${workflowId} on branch ${branch}`);
    return true;
  } catch (error) {
    core.warning(`Failed to dispatch workflow: ${error}`);
    return false;
  }
}

export async function waitForWorkflowCompletion(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  headSha: string,
  options: WorkflowWaitOptions = {},
): Promise<CIWorkflowRun | null> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const cooldownMs = options.cooldownMs ?? 30 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const dispatchWorkflowId = options.dispatchWorkflowId ?? null;
  const dispatchOctokit = options.dispatchOctokit ?? octokit;
  const emptyPollsBeforeDispatch = Math.max(1, options.emptyPollsBeforeDispatch ?? 3);
  core.info(`Waiting for CI to complete on ${branch} (sha: ${headSha.substring(0, 7)})...`);

  await sleep(cooldownMs);

  const startedAt = Date.now();
  let emptyPolls = 0;
  let dispatchAttempted = false;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        head_sha: headSha,
        per_page: 10,
      });

      const runs = data.workflow_runs as WorkflowRunApiRecord[];
      if (runs.length === 0) {
        emptyPolls += 1;
        if (!dispatchAttempted && dispatchWorkflowId && emptyPolls >= emptyPollsBeforeDispatch) {
          dispatchAttempted = true;
          core.warning(
            `No workflow runs were created for ${headSha.substring(0, 7)} after ${emptyPolls} poll(s); attempting workflow_dispatch fallback for workflow ${dispatchWorkflowId}.`,
          );
          const dispatched = await triggerWorkflowDispatch(
            dispatchOctokit,
            owner,
            repo,
            dispatchWorkflowId,
            branch,
          );
          if (!dispatched) {
            core.warning(
              'Workflow dispatch fallback failed. Ensure the watched workflow declares workflow_dispatch and that trigger-token can run workflows.',
            );
          }
        } else {
          core.info('No workflow runs found yet, waiting...');
        }
        await sleep(pollIntervalMs);
        continue;
      }

      emptyPolls = 0;
      const allCompleted = runs.every((run) => run.status === 'completed');
      if (!allCompleted) {
        const inProgress = runs.filter((run) => run.status !== 'completed');
        core.info(`${inProgress.length} workflow(s) still running...`);
        await sleep(pollIntervalMs);
        continue;
      }

      const failedRun = runs.find((run) => run.conclusion === 'failure');
      if (failedRun) {
        core.info(`Workflow '${failedRun.name}' failed`);
        return toCiWorkflowRun(failedRun);
      }

      core.info('All workflows passed');
      return toCiWorkflowRun({
        ...runs[0],
        conclusion: 'success',
      });
    } catch (error) {
      core.warning(`Error checking workflow status: ${error}`);
      await sleep(pollIntervalMs);
    }
  }

  core.warning(`Timed out waiting for CI after ${timeoutMs / 1000}s`);
  return null;
}

export async function getLatestRunForBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  workflowName?: string,
): Promise<CIWorkflowRun | null> {
  try {
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch,
      per_page: 5,
      status: 'completed',
    });

    const allRuns = data.workflow_runs as WorkflowRunApiRecord[];
    const runs = workflowName
      ? allRuns.filter((run) => run.name === workflowName)
      : allRuns;

    if (runs.length === 0) {
      return null;
    }

    return toCiWorkflowRun(runs[0]);
  } catch (error) {
    core.warning(`Failed to get latest run: ${error}`);
    return null;
  }
}

function toCiWorkflowRun(run: WorkflowRunApiRecord): CIWorkflowRun {
  return {
    id: run.id,
    workflowId: run.workflow_id ?? null,
    name: run.name || '',
    headBranch: run.head_branch || '',
    headSha: run.head_sha,
    status: run.status || '',
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    event: run.event,
    pullRequests: ((run.pull_requests || []) as PullRequestApiRecord[]).map((pullRequest) => ({
      number: pullRequest.number,
      headRef: pullRequest.head.ref,
      headSha: pullRequest.head.sha,
    })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
