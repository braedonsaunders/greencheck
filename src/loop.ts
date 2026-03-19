import * as core from '@actions/core';
import * as github from '@actions/github';
import { invokeAgent } from './agent';
import { waitForWorkflowCompletion } from './ci-trigger';
import { discardAllChanges, discardChangesForFiles, getChangedFiles, getCurrentSha, pushChanges, revertCommit, commitFix } from './git-ops';
import { readAndParseFailures } from './log-reader';
import { saveCheckpoint } from './checkpoint';
import { triageFailures } from './triage';
import { FailureCluster, FailureRecord, FixAttempt, GreenCheckConfig, RunState } from './types';
import { normalizePath } from './glob';

type Octokit = ReturnType<typeof github.getOctokit>;

export async function runFixLoop(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: RunState,
  config: GreenCheckConfig,
): Promise<RunState> {
  const runStartedAt = new Date(state.startedAt).getTime();

  for (let pass = state.passes.length + 1; pass <= config.maxPasses; pass++) {
    const elapsed = Date.now() - runStartedAt;
    if (elapsed >= config.timeoutMs) {
      core.warning(`Timeout reached after ${config.timeoutMs / 1000}s`);
      state.result = 'failed';
      break;
    }

    if (state.totalCostCents >= config.maxCostCents) {
      core.warning(`Cost limit reached: ${state.totalCostCents}c / ${config.maxCostCents}c`);
      state.result = 'failed';
      break;
    }

    core.info(`\n${'='.repeat(60)}`);
    core.info(`Pass ${pass}/${config.maxPasses}`);
    core.info(`${'='.repeat(60)}\n`);

    const logResult = await readAndParseFailures(octokit, owner, repo, state.workflowRunId);
    state.latestFailures = logResult.failures;

    if (logResult.failures.length === 0) {
      core.info('No failures found in logs - CI may already be green');
      state.result = 'success';
      break;
    }

    const clusters = triageFailures(logResult.failures, config);
    if (clusters.length === 0) {
      core.info('No fixable failure clusters after triage');
      state.result = 'failed';
      break;
    }

    const cluster = clusters[0];
    const attempt = await fixCluster(cluster, pass, config);
    state.passes.push(attempt);
    state.totalCostCents += attempt.costCents;
    if (attempt.commitSha) {
      state.commits.push(attempt.commitSha);
    }
    saveCheckpoint(state);

    if (attempt.result !== 'fixed') {
      state.result = 'failed';
      break;
    }

    if (config.dryRun) {
      core.info('Dry run enabled - skipping push and CI re-trigger');
      state.result = 'partial';
      break;
    }

    const pushed = await pushChanges(state.branch, config.triggerToken, owner, repo);
    if (!pushed) {
      state.result = 'failed';
      break;
    }

    const newSha = await getCurrentSha();
    const ciResult = await waitForWorkflowCompletion(
      octokit,
      owner,
      repo,
      state.branch,
      newSha,
      getRemainingBudget(config.timeoutMs, runStartedAt),
    );

    if (!ciResult) {
      core.warning('Timed out waiting for CI');
      state.result = 'failed';
      break;
    }

    state.workflowRunId = ciResult.id;
    state.headSha = ciResult.headSha;

    if (ciResult.conclusion === 'success') {
      core.info('CI is green. All tracked failures are fixed.');
      state.latestFailures = [];
      state.result = 'success';
      break;
    }

    const newLogResult = await readAndParseFailures(octokit, owner, repo, ciResult.id);
    state.latestFailures = newLogResult.failures;

    const regressions = getNewFailures(logResult.failures, newLogResult.failures);
    if (regressions.length > 0 && config.safety.revertOnRegression && attempt.commitSha) {
      core.warning(`${regressions.length} new failures detected after pass ${pass}`);
      attempt.result = 'regression';
      attempt.newFailures = regressions;

      const reverted = await revertRegressiveCommit(
        octokit,
        owner,
        repo,
        state,
        attempt.commitSha,
        config,
        runStartedAt,
      );

      if (!reverted) {
        state.result = 'failed';
        break;
      }

      if (state.result === 'success') {
        break;
      }
    }
  }

  if (!state.result) {
    state.result = state.commits.length > 0 ? 'partial' : 'failed';
  }

  return state;
}

async function fixCluster(
  cluster: FailureCluster,
  pass: number,
  config: GreenCheckConfig,
): Promise<FixAttempt> {
  const startedAt = Date.now();

  core.info(`Fixing ${cluster.type} cluster: ${cluster.files.join(', ')}`);
  core.info(`Strategy: ${cluster.strategy}, Failures: ${cluster.failures.length}`);

  try {
    const invocation = await invokeAgent(cluster, config, process.cwd());
    if (invocation.exitCode !== 0) {
      core.warning(`Agent exited with ${invocation.exitCode}; checking whether it still produced usable changes`);
    }

    const allowedFiles = new Set(cluster.files.map(normalizePath));
    const changedFiles = await getChangedFiles();
    const normalizedChangedFiles = changedFiles.map(normalizePath);

    const unexpectedFiles = changedFiles.filter(
      (file, index) => !allowedFiles.has(normalizedChangedFiles[index]),
    );
    if (unexpectedFiles.length > 0) {
      core.warning(`Discarding out-of-scope file changes: ${unexpectedFiles.join(', ')}`);
      await discardChangesForFiles(unexpectedFiles);
    }

    const remainingFiles = (await getChangedFiles()).filter((file) => allowedFiles.has(normalizePath(file)));
    if (remainingFiles.length === 0) {
      core.warning('Agent produced no in-scope changes');
      return {
        pass,
        cluster,
        commitSha: null,
        filesChanged: [],
        result: 'failed',
        newFailures: [],
        costCents: invocation.costCents,
        durationMs: Date.now() - startedAt,
      };
    }

    const commitSha = config.dryRun ? null : await commitFix(cluster, pass, config);

    return {
      pass,
      cluster,
      commitSha,
      filesChanged: remainingFiles,
      result: commitSha || config.dryRun ? 'fixed' : 'failed',
      newFailures: [],
      costCents: invocation.costCents,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    core.error(`Fix attempt failed: ${error}`);
    await discardAllChanges();

    return {
      pass,
      cluster,
      commitSha: null,
      filesChanged: [],
      result: 'failed',
      newFailures: [],
      costCents: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function revertRegressiveCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: RunState,
  commitSha: string,
  config: GreenCheckConfig,
  runStartedAt: number,
): Promise<boolean> {
  const reverted = await revertCommit(commitSha);
  if (!reverted) {
    return false;
  }

  state.commits = state.commits.filter((sha) => sha !== commitSha);

  const pushed = await pushChanges(state.branch, config.triggerToken, owner, repo);
  if (!pushed) {
    return false;
  }

  const revertSha = await getCurrentSha();
  const revertedRun = await waitForWorkflowCompletion(
    octokit,
    owner,
    repo,
    state.branch,
    revertSha,
    getRemainingBudget(config.timeoutMs, runStartedAt),
  );

  if (!revertedRun) {
    return false;
  }

  state.workflowRunId = revertedRun.id;
  state.headSha = revertedRun.headSha;

  if (revertedRun.conclusion === 'success') {
    state.latestFailures = [];
    state.result = 'success';
    return true;
  }

  const revertedLogResult = await readAndParseFailures(octokit, owner, repo, revertedRun.id);
  state.latestFailures = revertedLogResult.failures;
  saveCheckpoint(state);
  return true;
}

function getNewFailures(previous: FailureRecord[], next: FailureRecord[]): FailureRecord[] {
  const previousKeys = new Set(previous.map(getFailureKey));
  return next.filter((failure) => !previousKeys.has(getFailureKey(failure)));
}

function getFailureKey(failure: FailureRecord): string {
  return `${normalizePath(failure.file)}:${failure.line}:${failure.column}:${failure.type}:${failure.message}`;
}

function getRemainingBudget(timeoutMs: number, runStartedAt: number): number {
  return Math.max(15_000, timeoutMs - (Date.now() - runStartedAt));
}
