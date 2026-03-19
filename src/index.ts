import * as core from '@actions/core';
import * as github from '@actions/github';
import { clearCheckpoint, loadCheckpoint } from './checkpoint';
import { loadConfig } from './config';
import { checkoutBranch, getCurrentSha, pullLatest } from './git-ops';
import { getFailedWorkflowRun } from './log-reader';
import { runFixLoop } from './loop';
import { report } from './report';
import { GreenCheckConfig, RunState } from './types';

async function run(): Promise<void> {
  try {
    const config = loadConfig();

    if (!config.agentApiKey && !config.agentOAuthToken) {
      core.setFailed('Either agent-api-key or agent-oauth-token must be provided');
      return;
    }

    if (config.agent === 'codex' && !config.agentApiKey) {
      core.setFailed('Codex CI runs require agent-api-key. OAuth-only Codex auth is not supported here.');
      return;
    }

    if (!config.githubToken) {
      core.setFailed('github-token is required');
      return;
    }

    if (!config.triggerToken) {
      core.setFailed('trigger-token is required');
      return;
    }

    const octokit = github.getOctokit(config.githubToken);
    const { owner, repo } = github.context.repo;

    core.info('='.repeat(60));
    core.info('greencheck - CI autofix orchestrator');
    core.info('='.repeat(60));
    core.info(`Agent: ${config.agent}`);
    core.info(`Max passes: ${config.maxPasses}`);
    core.info(`Max cost: $${(config.maxCostCents / 100).toFixed(2)}`);
    core.info(`Timeout: ${config.timeoutMs / 1000}s`);
    core.info(`Dry run: ${config.dryRun}`);
    core.info('');

    const workflowRunId = getWorkflowRunId();
    if (!workflowRunId) {
      core.setFailed('Could not determine the failed workflow run ID. Use workflow_run or set workflow-run-id.');
      return;
    }

    core.info(`Processing workflow run: ${workflowRunId}`);

    const failedRun = await getFailedWorkflowRun(octokit, owner, repo, workflowRunId);
    if (!failedRun) {
      core.info('Workflow run is not a failure or could not be fetched. Nothing to do.');
      return;
    }

    if (config.watchWorkflows.length > 0 && !config.watchWorkflows.includes(failedRun.name)) {
      core.info(`Workflow '${failedRun.name}' is not in the watch list, skipping`);
      return;
    }

    if (config.watch.branches.length > 0 && !config.watch.branches.includes(failedRun.headBranch)) {
      core.info(`Branch '${failedRun.headBranch}' is not in the watch list, skipping`);
      return;
    }

    const prNumber = failedRun.pullRequests.length > 0 ? failedRun.pullRequests[0].number : null;

    core.info(`Branch: ${failedRun.headBranch}`);
    core.info(`SHA: ${failedRun.headSha}`);
    core.info(`PR: ${prNumber ? `#${prNumber}` : 'none'}`);

    await checkoutBranch(failedRun.headBranch);
    await pullLatest(failedRun.headBranch);

    const currentSha = await getCurrentSha();
    if (currentSha !== failedRun.headSha) {
      core.info(
        `Branch '${failedRun.headBranch}' advanced from ${failedRun.headSha.substring(0, 7)} to ${currentSha.substring(0, 7)}; skipping stale failure context.`,
      );
      return;
    }

    let state = getInitialState(failedRun.id, failedRun.headBranch, failedRun.headSha, prNumber);
    const checkpoint = loadCheckpoint();
    if (checkpoint && shouldResumeCheckpoint(checkpoint, failedRun.id, failedRun.headBranch)) {
      state = checkpoint;
      state.latestFailures = checkpoint.latestFailures || [];
      core.info(`Resuming checkpoint for workflow run ${checkpoint.workflowRunId}`);
    } else if (checkpoint) {
      core.info('Ignoring checkpoint because it does not match the current workflow run');
    }

    state = await runFixLoop(octokit, owner, repo, state, config);

    await report(octokit, owner, repo, state, config);

    if (config.autoMerge && state.result === 'success' && prNumber && !config.dryRun) {
      await attemptAutoMerge(octokit, owner, repo, prNumber, state, config);
    }

    clearCheckpoint();

    if (state.result === 'success') {
      core.info('\ngreencheck: CI is green');
    } else if (state.result === 'partial') {
      core.warning('\ngreencheck: partially fixed - some failures remain');
    } else {
      core.setFailed('\ngreencheck: could not fix all failures');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`greencheck failed: ${error.message}`);
    } else {
      core.setFailed('greencheck failed with an unknown error');
    }
  }
}

function getWorkflowRunId(): number | null {
  const payload = github.context.payload;
  if (payload.workflow_run?.id) {
    return payload.workflow_run.id;
  }

  const inputRunId = core.getInput('workflow-run-id');
  if (inputRunId) {
    return Number.parseInt(inputRunId, 10);
  }

  if (payload.check_suite?.id) {
    core.warning('check_suite events are not supported yet. Trigger greencheck from workflow_run instead.');
  }

  if (payload.issue?.pull_request) {
    core.warning('issue_comment triggers are not supported yet. Trigger greencheck from workflow_run instead.');
  }

  return null;
}

function getInitialState(
  workflowRunId: number,
  branch: string,
  headSha: string,
  prNumber: number | null,
): RunState {
  return {
    runId: Date.now(),
    workflowRunId,
    branch,
    headSha,
    prNumber,
    passes: [],
    totalCostCents: 0,
    startedAt: new Date().toISOString(),
    result: null,
    commits: [],
    latestFailures: [],
  };
}

function shouldResumeCheckpoint(
  checkpoint: RunState,
  workflowRunId: number,
  branch: string,
): boolean {
  return checkpoint.workflowRunId === workflowRunId && checkpoint.branch === branch;
}

async function attemptAutoMerge(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  state: RunState,
  config: GreenCheckConfig,
): Promise<void> {
  core.info('Checking auto-merge conditions...');

  if (state.commits.length > config.merge.maxCommits) {
    core.info(`Too many commits (${state.commits.length} > ${config.merge.maxCommits}), skipping auto-merge`);
    return;
  }

  for (const pattern of config.merge.protectedPatterns) {
    if (pattern.endsWith('*')) {
      if (state.branch.startsWith(pattern.slice(0, -1))) {
        core.info(`Branch '${state.branch}' matches protected pattern '${pattern}', skipping auto-merge`);
        return;
      }
    } else if (state.branch === pattern) {
      core.info(`Branch '${state.branch}' is protected, skipping auto-merge`);
      return;
    }
  }

  if (config.merge.requireLabel) {
    try {
      const { data: pullRequest } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      const hasLabel = pullRequest.labels.some((label: any) => label.name === 'greencheck:auto-merge');
      if (!hasLabel) {
        core.info('PR does not have greencheck:auto-merge label, skipping auto-merge');
        return;
      }
    } catch (error) {
      core.warning(`Could not check PR labels: ${error}`);
      return;
    }
  }

  try {
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });
    const approved = reviews.some((review: any) => review.state === 'APPROVED');
    if (!approved) {
      core.info('PR has no approved reviews, skipping auto-merge');
      return;
    }
  } catch (error) {
    core.warning(`Could not check PR reviews: ${error}`);
    return;
  }

  try {
    await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: 'squash',
      commit_title: `greencheck: auto-merge PR #${prNumber}`,
      commit_message: `Automated merge by greencheck after fixing CI failures.\n\nCommits: ${state.commits.map((sha) => sha.substring(0, 7)).join(', ')}`,
    });
    core.info(`Auto-merged PR #${prNumber}`);
  } catch (error) {
    core.warning(`Auto-merge failed: ${error}`);
  }
}

run();
