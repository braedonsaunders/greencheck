import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { FailureCluster, GreenCheckConfig } from './types';
import { matchesGlob } from './glob';

async function git(
  args: string[],
  cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';

  const exitCode = await exec.exec('git', args, {
    cwd,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
      stderr: (data) => {
        stderr += data.toString();
      },
    },
    ignoreReturnCode: true,
    silent: true,
  });

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

export async function checkoutBranch(branch: string, cwd?: string): Promise<void> {
  core.info(`Checking out branch: ${branch}`);

  const fetchResult = await git(['fetch', '--no-tags', 'origin', branch], cwd);
  if (fetchResult.exitCode !== 0) {
    throw new Error(`Failed to fetch branch ${branch}: ${fetchResult.stderr}`);
  }

  const checkoutResult = await git(['checkout', '-B', branch, `origin/${branch}`], cwd);
  if (checkoutResult.exitCode !== 0) {
    throw new Error(`Failed to checkout branch ${branch}: ${checkoutResult.stderr}`);
  }
}

export async function pullLatest(branch: string, cwd?: string): Promise<void> {
  const result = await git(['pull', '--rebase', 'origin', branch], cwd);
  if (result.exitCode !== 0) {
    core.warning(`Pull failed for ${branch}, continuing with current state: ${result.stderr}`);
  }
}

export async function getChangedFiles(cwd?: string): Promise<string[]> {
  const tracked = await git(['diff', '--name-only', '--relative', 'HEAD'], cwd);
  const staged = await git(['diff', '--cached', '--name-only', '--relative'], cwd);
  const untracked = await git(['ls-files', '--others', '--exclude-standard'], cwd);

  return [...new Set(
    [tracked.stdout, staged.stdout, untracked.stdout]
      .flatMap((output) => output.split('\n'))
      .map((line) => line.trim())
      .filter(Boolean),
  )];
}

export async function commitFix(
  cluster: FailureCluster,
  passNumber: number,
  config: GreenCheckConfig,
  agentSummary: string | null,
  cwd?: string,
): Promise<{ commitSha: string | null; filesCommitted: string[] }> {
  const changedFiles = await getChangedFiles(cwd);
  if (changedFiles.length === 0) {
    core.info('No changes to commit');
    return { commitSha: null, filesCommitted: [] };
  }

  const safeFiles = changedFiles.filter(
    (file) => !isProtectedFile(file, config.safety.neverTouchFiles),
  );

  if (safeFiles.length === 0) {
    core.warning('All changed files are protected, discarding changes');
    await discardAllChanges(cwd);
    return { commitSha: null, filesCommitted: [] };
  }

  core.info(`Changed files detected: ${safeFiles.join(', ')}`);

  const protectedFiles = changedFiles.filter(
    (file) => isProtectedFile(file, config.safety.neverTouchFiles),
  );
  if (protectedFiles.length > 0) {
    await discardChangesForFiles(protectedFiles, cwd);
  }

  for (const file of safeFiles) {
    const addResult = await git(['add', '--', file], cwd);
    if (addResult.exitCode !== 0) {
      throw new Error(`Failed to stage ${file}: ${addResult.stderr}`);
    }
  }

  const failuresSummary = cluster.failures
    .slice(0, 5)
    .map((failure) => `  - ${failure.type}: ${failure.message}`)
    .join('\n');
  const truncated = cluster.failures.length > 5
    ? `\n  ... and ${cluster.failures.length - 5} more`
    : '';
  const scopeLabel = safeFiles.length > 0 ? safeFiles.join(', ') : 'repository';
  const summaryHeader = cluster.failures.length > 0
    ? `Fixed ${cluster.failures.length} ${cluster.type} failure(s) related to ${scopeLabel}`
    : `Investigated workflow failure and updated ${scopeLabel}`;
  const failuresSection = cluster.failures.length > 0
    ? `Failures addressed:
${failuresSummary}${truncated}

`
    : '';
  const agentSection = agentSummary
    ? `Agent summary:
${formatAgentSummary(agentSummary)}

`
    : '';

  const message = `${buildCommitSubject(cluster, safeFiles, passNumber, agentSummary)}

${summaryHeader}

${agentSection}${failuresSection}Automated fix by greencheck - https://github.com/braedonsaunders/greencheck`;

  await git(['config', 'user.name', 'greencheck[bot]'], cwd);
  await git(['config', 'user.email', 'greencheck[bot]@users.noreply.github.com'], cwd);

  const commitResult = await git(['commit', '-m', message], cwd);
  if (commitResult.exitCode !== 0) {
    core.error(`Commit failed: ${commitResult.stderr}`);
    return { commitSha: null, filesCommitted: [] };
  }

  const shaResult = await git(['rev-parse', 'HEAD'], cwd);
  core.info(`Committed fix: ${shaResult.stdout.substring(0, 7)}`);
  return {
    commitSha: shaResult.stdout,
    filesCommitted: safeFiles,
  };
}

function buildCommitSubject(
  cluster: FailureCluster,
  files: string[],
  passNumber: number,
  agentSummary: string | null,
): string {
  const summaryLine = firstUsefulSummaryLine(agentSummary);
  if (summaryLine) {
    return `greencheck: ${truncateCommitSubject(summaryLine)} (pass ${passNumber})`;
  }

  if (cluster.failures.length > 0) {
    return `greencheck: fix ${cluster.type} failures (pass ${passNumber})`;
  }

  return `greencheck: update ${summarizeFiles(files)} (pass ${passNumber})`;
}

function firstUsefulSummaryLine(agentSummary: string | null): string | null {
  if (!agentSummary) {
    return null;
  }

  for (const rawLine of agentSummary.split('\n')) {
    const line = rawLine
      .replace(/^#+\s*/, '')
      .replace(/^\*\*|\*\*$/g, '')
      .trim();

    if (!line) {
      continue;
    }

    if (/^all \d+ tests pass/i.test(line) || /^summary of changes/i.test(line)) {
      continue;
    }

    return line;
  }

  return null;
}

function truncateCommitSubject(value: string): string {
  const sanitized = value.replace(/\s+/g, ' ').trim();
  if (sanitized.length <= 72) {
    return sanitized;
  }

  return `${sanitized.slice(0, 69).trimEnd()}...`;
}

function summarizeFiles(files: string[]): string {
  if (files.length === 0) {
    return 'repository changes';
  }

  if (files.length === 1) {
    return files[0];
  }

  if (files.length === 2) {
    return `${files[0]} and ${files[1]}`;
  }

  return `${files[0]}, ${files[1]}, and ${files.length - 2} more file(s)`;
}

function formatAgentSummary(agentSummary: string): string {
  return agentSummary.trim().split('\n').slice(0, 12).join('\n');
}

export async function pushChanges(
  branch: string,
  token: string,
  owner: string,
  repo: string,
  cwd?: string,
): Promise<boolean> {
  const originalRemote = await git(['remote', 'get-url', 'origin'], cwd);
  const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

  try {
    const setUrlResult = await git(['remote', 'set-url', 'origin', remoteUrl], cwd);
    if (setUrlResult.exitCode !== 0) {
      core.error(`Failed to update origin remote: ${setUrlResult.stderr}`);
      return false;
    }

    const pushResult = await git(['push', 'origin', `HEAD:${branch}`], cwd);
    if (pushResult.exitCode !== 0) {
      core.error(`Push failed: ${pushResult.stderr}`);
      return false;
    }

    core.info(`Pushed to ${branch}`);
    return true;
  } finally {
    if (originalRemote.exitCode === 0 && originalRemote.stdout) {
      await git(['remote', 'set-url', 'origin', originalRemote.stdout], cwd);
    }
  }
}

export async function revertCommit(sha: string, cwd?: string): Promise<boolean> {
  core.info(`Reverting commit ${sha.substring(0, 7)}`);
  const result = await git(['revert', '--no-edit', sha], cwd);
  if (result.exitCode !== 0) {
    core.error(`Revert failed: ${result.stderr}`);
    return false;
  }

  return true;
}

export async function discardChangesForFiles(files: string[], cwd?: string): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const restoreResult = await git(['restore', '--staged', '--worktree', '--source=HEAD', '--', ...files], cwd);
  if (restoreResult.exitCode !== 0) {
    core.warning(`Failed to restore files from HEAD: ${restoreResult.stderr}`);
  }

  const cleanResult = await git(['clean', '-fd', '--', ...files], cwd);
  if (cleanResult.exitCode !== 0) {
    core.warning(`Failed to remove untracked files: ${cleanResult.stderr}`);
  }
}

export async function discardAllChanges(cwd?: string): Promise<void> {
  await git(['restore', '--staged', '--worktree', '--source=HEAD', '.'], cwd);
  await git(['clean', '-fd', '--', '.', ':(exclude).greencheck'], cwd);
}

export async function getCurrentSha(cwd?: string): Promise<string> {
  const result = await git(['rev-parse', 'HEAD'], cwd);
  return result.stdout;
}

function isProtectedFile(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(file, pattern));
}
