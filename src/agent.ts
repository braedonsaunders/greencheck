import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { AgentInvocation, FailureCluster, GreenCheckConfig } from './types';

function buildPrompt(cluster: FailureCluster): string {
  const failureList = cluster.failures
    .map((failure, index) => {
      const location = failure.line
        ? `${failure.file}:${failure.line}${failure.column ? `:${failure.column}` : ''}`
        : failure.file;
      const rule = failure.rule ? ` [${failure.rule}]` : '';
      return `${index + 1}. ${cluster.type}${rule} at ${location} - ${failure.message}`;
    })
    .join('\n');

  const fileList = cluster.files.map((file) => `- ${file}`).join('\n');

  return `Fix the following CI failures in this repository.

## Files in scope
${fileList}

## Failures
${failureList}

## Constraints
- Fix only the failures listed above.
- Do not modify files outside the scope list unless a generated lockfile changes as a direct result of the fix.
- Prefer the smallest possible code change.
- Do not add new dependencies unless the failure cannot be resolved without them.
- Run the narrowest verification you can for the changed area before you finish.`;
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

  if (config.agent === 'claude') {
    if (config.agentOAuthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = config.agentOAuthToken;
    } else if (config.agentApiKey) {
      env.ANTHROPIC_API_KEY = config.agentApiKey;
    }
  } else if (config.agentApiKey) {
    env.CODEX_API_KEY = config.agentApiKey;
    env.OPENAI_API_KEY = config.agentApiKey;
  }

  return env;
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
    '20',
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
    silent: false,
  });

  return {
    agent,
    mode,
    prompt,
    model: config.model,
    filesChanged: [],
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

export async function invokeAgent(
  cluster: FailureCluster,
  config: GreenCheckConfig,
  workDir: string,
): Promise<AgentInvocation> {
  const prompt = buildPrompt(cluster);
  core.info(`Invoking ${config.agent} for ${cluster.type} failures in ${cluster.files.join(', ')}`);

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
