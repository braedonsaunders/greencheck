import * as core from '@actions/core';
import * as github from '@actions/github';
import { CIWorkflowRun } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;
type WorkflowRunApiRecord = any;
type PullRequestApiRecord = any;

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
  timeoutMs: number = 10 * 60 * 1000,
  cooldownMs: number = 30 * 1000,
): Promise<CIWorkflowRun | null> {
  core.info(`Waiting for CI to complete on ${branch} (sha: ${headSha.substring(0, 7)})...`);

  await sleep(cooldownMs);

  const startedAt = Date.now();
  const pollInterval = 15_000;

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
        core.info('No workflow runs found yet, waiting...');
        await sleep(pollInterval);
        continue;
      }

      const allCompleted = runs.every((run) => run.status === 'completed');
      if (!allCompleted) {
        const inProgress = runs.filter((run) => run.status !== 'completed');
        core.info(`${inProgress.length} workflow(s) still running...`);
        await sleep(pollInterval);
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
      await sleep(pollInterval);
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
