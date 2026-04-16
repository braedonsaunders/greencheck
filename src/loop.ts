import * as core from '@actions/core';
import * as github from '@actions/github';
import { invokeAgent } from './agent';
import { waitForWorkflowCompletion } from './ci-trigger';
import { discardAllChanges, getChangedFiles, getCurrentSha, pushChanges, revertCommit, commitFix } from './git-ops';
import { readAndParseFailures } from './log-reader';
import { saveCheckpoint } from './checkpoint';
import { triageFailures } from './triage';
import { AgentContext, AgentInvocation, FailureCluster, FailureRecord, FixAttempt, GreenCheckConfig, LogParserResult, RunState } from './types';
import { normalizePath } from './glob';

type Octokit = ReturnType<typeof github.getOctokit>;

const TEST_FAILURE_MAX_FILES_PER_CLUSTER = 3;
const TEST_FAILURE_MAX_FAILURES_PER_CLUSTER = 5;

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
    state.latestParserUsed = logResult.parserUsed;
    state.latestLogPath = logResult.logPath;

    if (!logResult.rawLog) {
      core.warning('No workflow log content was retrieved; continuing anyway so the agent can inspect the repository directly');
    }

    const cluster = buildAgentCluster(logResult, config);
    const context = buildAgentContext(state, logResult);
    const attempt = await fixCluster(context, cluster, pass, config);
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
      state.latestParserUsed = 'none';
      state.latestLogPath = null;
      state.result = 'success';
      break;
    }

    const newLogResult = await readAndParseFailures(octokit, owner, repo, ciResult.id);
    state.latestFailures = newLogResult.failures;
    state.latestParserUsed = newLogResult.parserUsed;
    state.latestLogPath = newLogResult.logPath;

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
  context: AgentContext,
  cluster: FailureCluster,
  pass: number,
  config: GreenCheckConfig,
): Promise<FixAttempt> {
  const startedAt = Date.now();

  const fileSummary = cluster.files.length > 0 ? cluster.files.join(', ') : 'repository-wide';
  core.info(`Fixing workflow failure with agent-first flow (${fileSummary})`);
  core.info(`Parsed hints: ${cluster.failures.length}, parserUsed: ${context.parserUsed}`);

  try {
    const invocation = await invokeAgent(context, cluster, config, process.cwd());
    if (invocation.exitCode !== 0) {
      logAgentOutput(invocation);
      core.warning(`Agent exited with ${invocation.exitCode}; checking whether it still produced usable changes`);
    }

    const changedFiles = await getChangedFiles();
    if (changedFiles.length === 0) {
      if (invocation.exitCode === 0) {
        logAgentOutput(invocation);
      }
      core.warning('Agent produced no changes');
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

    const commitResult = config.dryRun
      ? { commitSha: null, filesCommitted: changedFiles }
      : await commitFix(cluster, pass, config, invocation.summary);

    if (!config.dryRun && commitResult.filesCommitted.length === 0) {
      core.warning('Agent changes could not be committed after protected-file filtering');
    }

    return {
      pass,
      cluster,
      commitSha: commitResult.commitSha,
      filesChanged: commitResult.filesCommitted,
      result: commitResult.commitSha || config.dryRun ? 'fixed' : 'failed',
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
    state.latestParserUsed = 'none';
    state.latestLogPath = null;
    state.result = 'success';
    return true;
  }

  const revertedLogResult = await readAndParseFailures(octokit, owner, repo, revertedRun.id);
  state.latestFailures = revertedLogResult.failures;
  state.latestParserUsed = revertedLogResult.parserUsed;
  state.latestLogPath = revertedLogResult.logPath;
  saveCheckpoint(state);
  return true;
}

export function buildAgentCluster(
  logResult: LogParserResult,
  config: GreenCheckConfig,
): FailureCluster {
  if (logResult.failures.length === 0) {
    return {
      type: 'unknown',
      files: [],
      failures: [],
      strategy: 'llm',
    };
  }

  const prioritized = triageFailures(logResult.failures, config);
  if (prioritized.length === 0) {
    const fallbackFiles = [...new Set(logResult.failures.map((failure) => failure.file))]
      .filter(Boolean)
      .slice(0, config.safety.maxFilesPerFix);
    const fallbackFailures = logResult.failures.filter((failure) => fallbackFiles.includes(failure.file));
    const fallbackType = fallbackFailures[0]?.type || 'unknown';

    return {
      type: fallbackType,
      files: fallbackFiles,
      failures: fallbackFailures,
      strategy: 'llm',
    };
  }

  const [selected, ...remaining] = prioritized;
  const files = [...selected.files];
  const failures = [...selected.failures];
  const seenFiles = new Set(files);
  const fileLimit = getClusterFileLimit(selected, config);
  const failureLimit = getClusterFailureLimit(selected);

  for (const cluster of remaining) {
    if (cluster.type !== selected.type) {
      break;
    }

    const additionalFiles = cluster.files.filter((file) => !seenFiles.has(file));
    if (files.length + additionalFiles.length > fileLimit) {
      break;
    }

    if (failures.length + cluster.failures.length > failureLimit) {
      break;
    }

    for (const file of additionalFiles) {
      seenFiles.add(file);
      files.push(file);
    }

    failures.push(...cluster.failures);
  }

  return {
    ...selected,
    files,
    failures,
  };
}

function buildAgentContext(state: RunState, logResult: LogParserResult): AgentContext {
  return {
    workflowRunId: state.workflowRunId,
    workflowName: state.workflowName,
    workflowUrl: state.workflowUrl,
    branch: state.branch,
    headSha: state.headSha,
    parserUsed: logResult.parserUsed,
    logPath: logResult.logPath,
    rawLog: logResult.rawLog,
    parsedFailures: logResult.failures,
  };
}

function getClusterFileLimit(cluster: FailureCluster, config: GreenCheckConfig): number {
  if (cluster.type === 'test-failure') {
    return Math.min(config.safety.maxFilesPerFix, TEST_FAILURE_MAX_FILES_PER_CLUSTER);
  }

  return config.safety.maxFilesPerFix;
}

function getClusterFailureLimit(cluster: FailureCluster): number {
  if (cluster.type === 'test-failure') {
    return TEST_FAILURE_MAX_FAILURES_PER_CLUSTER;
  }

  return Number.POSITIVE_INFINITY;
}

function logAgentOutput(invocation: AgentInvocation): void {
  const stdoutExcerpt = buildAgentOutputExcerpt(invocation.stdout);
  const stderrExcerpt = buildAgentOutputExcerpt(invocation.stderr);

  if (stdoutExcerpt) {
    core.info(`Agent stdout excerpt:\n${stdoutExcerpt}`);
  }

  if (stderrExcerpt) {
    core.warning(`Agent stderr excerpt:\n${stderrExcerpt}`);
  }
}

function buildAgentOutputExcerpt(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return '';
  }

  const excerpt = lines.slice(-40).join('\n');
  if (excerpt.length <= 4_000) {
    return excerpt;
  }

  return excerpt.slice(excerpt.length - 4_000);
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
