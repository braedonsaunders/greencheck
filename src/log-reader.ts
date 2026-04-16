import * as core from '@actions/core';
import * as github from '@actions/github';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import stripAnsi from 'strip-ansi';
import { parseLog } from './parsers';
import { CIWorkflowRun, FailureRecord, LogParserResult } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;

type LogPayload = ArrayBuffer | Buffer | Uint8Array | string;
type PullRequestApiRecord = any;
type WorkflowJobApiRecord = any;

type AdmZipConstructor = new (buffer: Buffer) => {
  getEntries(): Array<{
    isDirectory: boolean;
    getData(): Buffer;
  }>;
};

export async function getFailedWorkflowRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowRunId: number,
): Promise<CIWorkflowRun | null> {
  try {
    const { data: run } = await octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: workflowRunId,
    });

    if (run.conclusion !== 'failure') {
      core.info(`Workflow run ${workflowRunId} concluded with '${run.conclusion}', not failure`);
      return null;
    }

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
  } catch (error) {
    core.error(`Failed to get workflow run ${workflowRunId}: ${error}`);
    return null;
  }
}

export async function downloadWorkflowLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<string> {
  try {
    const { data } = await octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id: runId,
    });

    if (typeof data === 'string') {
      return data;
    }

    const admZip = await loadAdmZip();
    if (admZip) {
      const zip = new admZip(toBuffer(data as ArrayBuffer | Buffer | Uint8Array));
      const logParts = zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => entry.getData().toString('utf-8'));

      return logParts.join('\n');
    }

    return decodeLogPayload(data as LogPayload);
  } catch (error) {
    core.warning(`Failed to download logs for run ${runId}: ${error}`);
    return '';
  }
}

export async function getFailedJobLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<string> {
  try {
    const { data: jobsData } = await octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: runId,
      filter: 'latest',
    });

    const failedJobs = (jobsData.jobs as WorkflowJobApiRecord[]).filter(
      (job) => job.conclusion === 'failure',
    );
    if (failedJobs.length === 0) {
      core.info('No failed jobs found, downloading full run logs');
      return downloadWorkflowLogs(octokit, owner, repo, runId);
    }

    const logParts: string[] = [];
    for (const job of failedJobs) {
      try {
        const { data } = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
          owner,
          repo,
          job_id: job.id,
        });

        logParts.push(`=== Job: ${job.name} ===\n${decodeLogPayload(data as LogPayload)}`);
      } catch (error) {
        core.warning(`Failed to download log for job ${job.name}: ${error}`);
      }
    }

    return logParts.join('\n\n');
  } catch (error) {
    core.warning(`Failed to list jobs for run ${runId}: ${error}`);
    return downloadWorkflowLogs(octokit, owner, repo, runId);
  }
}

export async function readAndParseFailures(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<LogParserResult> {
  core.info(`Downloading logs for workflow run ${runId}...`);
  const rawLog = await getFailedJobLogs(octokit, owner, repo, runId);

  if (!rawLog) {
    core.warning('No log content retrieved');
    return { failures: [], rawLog: '', parserUsed: 'none', logPath: null };
  }

  const cleanLog = stripAnsi(rawLog);
  const normalizedLog = normalizeGithubActionsLog(cleanLog);
  const logPath = writeWorkflowLog(runId, normalizedLog);
  const parsed = parseLog(normalizedLog);
  const resolvedFailures = resolveFailurePaths(parsed.failures);
  core.info(`Downloaded ${normalizedLog.length} bytes of logs`);
  if (logPath) {
    core.info(`Saved workflow logs to ${logPath}`);
  }

  return {
    failures: resolvedFailures,
    rawLog: normalizedLog,
    parserUsed: parsed.parserUsed,
    logPath,
  };
}

function normalizeGithubActionsLog(log: string): string {
  return log
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((line) => line.replace(/^[^\t]+\t[^\t]+\t\d{4}-\d{2}-\d{2}T[0-9:.]+Z\s?/, ''))
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\s?/, ''))
    .map((line) => line.replace(/^##\[group\]/, '').replace(/^##\[endgroup\]$/, ''))
    .join('\n');
}

function decodeLogPayload(data: LogPayload): string {
  if (typeof data === 'string') {
    return data;
  }

  return toBuffer(data).toString('utf-8');
}

function toBuffer(data: ArrayBuffer | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }

  return Buffer.from(data);
}

async function loadAdmZip(): Promise<AdmZipConstructor | null> {
  try {
    const module = await import('adm-zip');
    return module.default as AdmZipConstructor;
  } catch {
    return null;
  }
}

function writeWorkflowLog(runId: number, content: string, workDir?: string): string | null {
  try {
    const baseDir = path.join(workDir || process.cwd(), '.greencheck', 'logs');
    fs.mkdirSync(baseDir, { recursive: true });

    const relativePath = path.join('.greencheck', 'logs', `workflow-run-${runId}.log`);
    const fullPath = path.join(workDir || process.cwd(), relativePath);
    fs.writeFileSync(fullPath, content, 'utf-8');
    return relativePath;
  } catch (error) {
    core.warning(`Failed to persist workflow logs locally: ${error}`);
    return null;
  }
}

export function resolveFailurePaths(
  failures: FailureRecord[],
  workDir = process.cwd(),
): FailureRecord[] {
  if (failures.length === 0) {
    return failures;
  }

  const repoFiles = listRepoFiles(workDir);
  if (repoFiles.length === 0) {
    return failures;
  }

  const resolutionCache = new Map<string, string>();
  return failures.map((failure) => ({
    ...failure,
    file: resolveFailurePath(failure.file, repoFiles, resolutionCache, workDir),
  }));
}

function resolveFailurePath(
  file: string,
  repoFiles: string[],
  resolutionCache: Map<string, string>,
  workDir: string,
): string {
  const normalizedInput = normalizeRepoPath(
    path.isAbsolute(file) ? path.relative(workDir, file) : file,
  );

  if (!normalizedInput) {
    return file;
  }

  const cached = resolutionCache.get(normalizedInput);
  if (cached) {
    return cached;
  }

  if (repoFiles.includes(normalizedInput)) {
    resolutionCache.set(normalizedInput, normalizedInput);
    return normalizedInput;
  }

  const suffixMatches = repoFiles.filter(
    (repoFile) => repoFile === normalizedInput || repoFile.endsWith(`/${normalizedInput}`),
  );
  if (suffixMatches.length === 1) {
    resolutionCache.set(normalizedInput, suffixMatches[0]);
    return suffixMatches[0];
  }

  resolutionCache.set(normalizedInput, normalizedInput);
  return normalizedInput;
}

function listRepoFiles(workDir: string): string[] {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map(normalizeRepoPath)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
