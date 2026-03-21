import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { AgentContext, AgentInvocation, FailureCluster, GreenCheckConfig } from './types';

function buildPrompt(context: AgentContext, cluster: FailureCluster): string {
  void cluster;
  const logAccess = context.logPath
    ? `- Full workflow logs are saved locally at \`${context.logPath}\``
    : '- Full workflow logs could not be saved locally; rely on git history, workflow files, and repo tooling';
  const logSummary = buildLogSummary(context.rawLog);
  const logSummarySection = logSummary
    ? `
## Failure excerpt from the workflow logs
${logSummary}
`
    : '';

  return `A GitHub Actions workflow failed for this repository. Take control immediately, investigate the failure, make the smallest reasonable fix, and verify it before you finish.

## Workflow context
- Workflow run id: ${context.workflowRunId}
- Workflow name: ${context.workflowName || 'unknown'}
- Workflow URL: ${context.workflowUrl || 'unknown'}
- Branch: ${context.branch}
- Commit SHA: ${context.headSha}
${logAccess}
${logSummarySection}
## Immediate workflow
- Open the saved workflow log file first and use it as source of truth.
- Re-run the exact failing commands you can infer from the CI logs, starting with the narrowest failing scope.
- Make the smallest fix that addresses the concrete failures you find, then verify with repo-native commands before finishing.

## What you should do
- Start from the failed CI context above.
- Read the saved workflow log file yourself if it exists.
- Inspect the repository's workflow files, scripts, package configuration, and source code as needed.
- Run the repository's own tests, linting, typechecking, or other narrow verification commands to confirm the fix.
- If the failure is ambiguous, investigate until you have a defensible fix instead of guessing.

## Constraints
- You have repository-wide edit access.
- Prefer the smallest reasonable code change that makes CI pass.
- Prefer fixing the underlying issue over simply silencing lint or type checks when the failing code looks incomplete or incorrectly wired.
- Do not add dependencies unless the failure genuinely requires it.
- Avoid changing protected files like lockfiles or secrets unless absolutely necessary; greencheck may discard those edits before commit.
- Before finishing, run the narrowest verification you can and leave the repo in a state that should pass CI.`;
}

async function commandExists(command: string): Promise<boolean> {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const exitCode = await exec.exec(lookupCommand, [command], {
    ignoreReturnCode: true,
    silent: true,
  });

  return exitCode === 0;
}

async function installAgent(agent: string): Promise<boolean> {
  const packageName = agent === 'claude' ? '@anthropic-ai/claude-code' : '@openai/codex';
  if (await commandExists(agent)) {
    core.info(`${agent} CLI already installed`);
    return true;
  }

  core.info(`Installing ${packageName}...`);
  const exitCode = await exec.exec('npm', ['install', '-g', `${packageName}@latest`], {
    ignoreReturnCode: true,
    silent: true,
  });

  return exitCode === 0;
}

function getAgentEnv(config: GreenCheckConfig): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  const oauthToken = sanitizeCredential(config.agentOAuthToken);
  const apiKey = sanitizeCredential(config.agentApiKey);

  if (config.agent === 'claude') {
    if (oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    } else if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey;
    }
  } else if (apiKey) {
    env.CODEX_API_KEY = apiKey;
    env.OPENAI_API_KEY = apiKey;
  }

  return env;
}

function sanitizeCredential(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const sanitized = value
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\s+/g, '');

  return sanitized || null;
}

function buildLogSummary(rawLog: string): string {
  if (!rawLog) {
    return '';
  }

  const commands = extractCommands(rawLog).slice(0, 8);
  const failureLines = extractFailureSnippet(rawLog).slice(0, 80);
  const sections: string[] = [];

  if (commands.length > 0) {
    sections.push('Commands observed in CI:');
    sections.push('```text');
    sections.push(...commands);
    sections.push('```');
  }

  if (failureLines.length > 0) {
    sections.push('Failure-focused log excerpt:');
    sections.push('```text');
    sections.push(...failureLines);
    sections.push('```');
  }

  return sections.join('\n');
}

function extractCommands(rawLog: string): string[] {
  const lines = rawLog.split('\n');
  const commands: string[] = [];

  for (const line of lines) {
    const match = line.match(/Run\s+(.+)$/);
    if (match) {
      const command = match[1].trim();
      if (!commands.includes(command)) {
        commands.push(command);
      }
    }
  }

  return commands;
}

function extractFailureSnippet(rawLog: string): string[] {
  const lines = rawLog.split('\n');
  const matches = new Set<number>();

  for (let index = 0; index < lines.length; index++) {
    if (/(failed|error|assert|Process completed with exit code|Traceback|Found \d+ errors\.)/i.test(lines[index])) {
      for (let offset = -2; offset <= 2; offset++) {
        const candidate = index + offset;
        if (candidate >= 0 && candidate < lines.length) {
          matches.add(candidate);
        }
      }
    }
  }

  return [...matches]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .filter(Boolean);
}

async function invokeClaude(
  prompt: string,
  config: GreenCheckConfig,
  workDir: string,
): Promise<AgentInvocation> {
  const args = [
    '-p',
    '--dangerously-skip-permissions',
    '--output-format',
    'json',
    '--max-turns',
    '50',
  ];

  if (config.model) {
    args.push('--model', config.model);
  }

  args.push(prompt);

  return runAgentCommand('claude', args, 'claude', 'sdk', prompt, config, workDir);
}

async function invokeCodex(
  prompt: string,
  config: GreenCheckConfig,
  workDir: string,
): Promise<AgentInvocation> {
  const args = [
    'exec',
    '--json',
    '--full-auto',
    '--sandbox',
    'workspace-write',
  ];

  if (config.model) {
    args.push('--model', config.model);
  }

  args.push(prompt);

  return runAgentCommand('codex', args, 'codex', 'sdk', prompt, config, workDir);
}

async function runAgentCommand(
  command: string,
  args: string[],
  agent: 'claude' | 'codex',
  mode: 'sdk' | 'cli',
  prompt: string,
  config: GreenCheckConfig,
  workDir: string,
): Promise<AgentInvocation> {
  const startTime = Date.now();
  let stdout = '';
  let stderr = '';

  const exitCode = await exec.exec(command, args, {
    cwd: workDir,
    env: getAgentEnv(config),
    ignoreReturnCode: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
      stderr: (data) => {
        stderr += data.toString();
      },
    },
    silent: true,
  });

  return {
    agent,
    mode,
    prompt,
    model: config.model,
    filesChanged: [],
    summary: extractAgentSummary(stdout),
    costCents: estimateCost(stdout.length + stderr.length + prompt.length, agent),
    durationMs: Date.now() - startTime,
    exitCode,
    stdout,
    stderr,
  };
}

function estimateCost(totalChars: number, agent: 'claude' | 'codex'): number {
  const tokens = totalChars / 4;
  const ratePerMillion = agent === 'claude' ? 5 : 3;
  return Math.round((tokens / 1_000_000) * ratePerMillion * 100);
}

function extractAgentSummary(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split('\n').reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { result?: unknown };
      if (typeof parsed.result === 'string' && parsed.result.trim()) {
        return parsed.result.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function invokeAgent(
  context: AgentContext,
  cluster: FailureCluster,
  config: GreenCheckConfig,
  workDir: string,
): Promise<AgentInvocation> {
  const prompt = buildPrompt(context, cluster);
  core.info(`Invoking ${config.agent} for workflow run ${context.workflowRunId} on ${context.branch}`);

  const installed = await installAgent(config.agent);
  if (!installed) {
    throw new Error(`Failed to install ${config.agent} CLI`);
  }

  const invocation = config.agent === 'claude'
    ? await invokeClaude(prompt, config, workDir)
    : await invokeCodex(prompt, config, workDir);

  if (invocation.exitCode !== 0) {
    core.warning(`${config.agent} exited with code ${invocation.exitCode}`);
  }

  return invocation;
}

export { buildPrompt };
