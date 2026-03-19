import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { AgentType, FailureType, GreenCheckConfig } from './types';

const ALL_FAILURE_TYPES: FailureType[] = [
  'lint',
  'type-error',
  'test-failure',
  'build-error',
  'runtime-error',
];

const DEFAULT_CONFIG_PATH = '.greencheck.yml';
const DEFAULT_MAX_PASSES = 5;
const DEFAULT_MAX_COST = '$3.00';
const DEFAULT_TIMEOUT = '20m';
const DEFAULT_PROTECTED_BRANCHES = ['main', 'master', 'develop', 'release/*'];
const DEFAULT_NEVER_TOUCH_FILES = ['*.lock', 'package-lock.json', '.env*'];
const DEFAULT_MAX_FILES_PER_FIX = 10;

interface RepoConfig {
  watch?: {
    workflows?: string[];
    branches?: string[];
    'ignore-authors'?: string[];
  };
  fix?: {
    agent?: string;
    model?: string;
    types?: string[];
    'max-passes'?: number;
    'max-cost'?: string;
    timeout?: string;
  };
  merge?: {
    enabled?: boolean;
    'max-commits'?: number;
    'require-label'?: boolean;
    'protected-patterns'?: string[];
  };
  report?: {
    'pr-comment'?: boolean;
    'job-summary'?: boolean;
    'slack-webhook'?: string;
  };
  safety?: {
    'never-touch-files'?: string[];
    'max-files-per-fix'?: number;
    'revert-on-regression'?: boolean;
  };
}

function inputEnvName(name: string): string {
  return `INPUT_${name.replace(/[-\s]/g, '_').toUpperCase()}`;
}

function getExplicitInput(name: string): string | undefined {
  const envValue = process.env[inputEnvName(name)];
  if (envValue === undefined) {
    return undefined;
  }

  const value = envValue.trim();
  return value.length > 0 ? value : '';
}

function getOptionalBooleanInput(name: string): boolean | undefined {
  const value = getExplicitInput(name);
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  core.warning(`Ignoring invalid boolean input '${name}': ${value}`);
  return undefined;
}

function getOptionalPositiveInteger(
  rawValue: string | number | undefined,
  fallback: number,
  label: string,
): number {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const value = typeof rawValue === 'number' ? rawValue : parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value < 1) {
    core.warning(`Ignoring invalid ${label}: ${rawValue}`);
    return fallback;
  }

  return value;
}

function parseCostCents(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const cleaned = rawValue.replace(/[$,]/g, '').trim();
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    core.warning(`Ignoring invalid max-cost value: ${rawValue}`);
    return fallback;
  }

  return Math.round(dollars * 100);
}

function parseTimeoutMs(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const match = rawValue.trim().match(/^(\d+)(s|m|h)$/i);
  if (!match) {
    core.warning(`Ignoring invalid timeout value: ${rawValue}`);
    return fallback;
  }

  const value = Number.parseInt(match[1], 10);
  if (value < 1) {
    core.warning(`Ignoring invalid timeout value: ${rawValue}`);
    return fallback;
  }

  switch (match[2].toLowerCase()) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      return fallback;
  }
}

function normalizeFailureType(value: string): FailureType | null {
  const normalized = value.trim().toLowerCase() as FailureType;
  return ALL_FAILURE_TYPES.includes(normalized) ? normalized : null;
}

function parseFixTypes(rawValue: string | string[] | undefined): FailureType[] | 'all' {
  if (!rawValue) {
    return 'all';
  }

  const values = Array.isArray(rawValue) ? rawValue : rawValue.split(',');
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return 'all';
  }

  if (normalized.some((value) => value.toLowerCase() === 'all')) {
    return 'all';
  }

  const parsed = normalized
    .map(normalizeFailureType)
    .filter((value): value is FailureType => value !== null);

  if (parsed.length === 0) {
    core.warning(`Ignoring invalid fix-types value: ${Array.isArray(rawValue) ? rawValue.join(',') : rawValue}`);
    return 'all';
  }

  return [...new Set(parsed)];
}

function parseWorkflows(rawValue: string | string[] | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  const values = Array.isArray(rawValue) ? rawValue : rawValue.split(',');
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0 || normalized.some((value) => value.toLowerCase() === 'all')) {
    return [];
  }

  return normalized;
}

function parseAgent(rawValue: string | undefined, fallback: AgentType): AgentType {
  if (!rawValue) {
    return fallback;
  }

  return rawValue === 'claude' || rawValue === 'codex' ? rawValue : fallback;
}

function loadRepoConfig(configPath: string): RepoConfig {
  const fullPath = path.resolve(configPath);
  if (!fs.existsSync(fullPath)) {
    core.info(`No config file found at ${fullPath}, using defaults`);
    return {};
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return YAML.parse(content) || {};
  } catch (error) {
    core.warning(`Failed to parse config file ${fullPath}: ${error}`);
    return {};
  }
}

export function loadConfig(): GreenCheckConfig {
  const explicitConfigPath = getExplicitInput('config-path');
  const configPath = explicitConfigPath || DEFAULT_CONFIG_PATH;
  const repo = loadRepoConfig(configPath);

  const defaultMaxCostCents = parseCostCents(DEFAULT_MAX_COST, 300);
  const defaultTimeoutMs = parseTimeoutMs(DEFAULT_TIMEOUT, 20 * 60 * 1000);

  const repoFixTypes = parseFixTypes(repo.fix?.types);
  const explicitFixTypes = parseFixTypes(getExplicitInput('fix-types'));

  const effectiveFixTypes = getExplicitInput('fix-types') !== undefined
    ? explicitFixTypes
    : repoFixTypes;

  return {
    agent: parseAgent(getExplicitInput('agent') || repo.fix?.agent, 'claude'),
    agentApiKey: getExplicitInput('agent-api-key') || core.getInput('agent-api-key') || null,
    agentOAuthToken: getExplicitInput('agent-oauth-token') || core.getInput('agent-oauth-token') || null,
    githubToken: core.getInput('github-token'),
    triggerToken: core.getInput('trigger-token'),
    maxPasses: getOptionalPositiveInteger(
      getExplicitInput('max-passes') ?? repo.fix?.['max-passes'],
      DEFAULT_MAX_PASSES,
      'max-passes',
    ),
    maxCostCents: parseCostCents(
      getExplicitInput('max-cost') ?? repo.fix?.['max-cost'],
      defaultMaxCostCents,
    ),
    timeoutMs: parseTimeoutMs(
      getExplicitInput('timeout') ?? repo.fix?.timeout,
      defaultTimeoutMs,
    ),
    autoMerge: getOptionalBooleanInput('auto-merge') ?? repo.merge?.enabled ?? false,
    watchWorkflows: parseWorkflows(
      getExplicitInput('watch-workflows') ?? repo.watch?.workflows,
    ),
    fixTypes: effectiveFixTypes,
    model: getExplicitInput('model') || repo.fix?.model || null,
    dryRun: getOptionalBooleanInput('dry-run') ?? false,
    configPath,

    watch: {
      workflows: parseWorkflows(repo.watch?.workflows),
      branches: repo.watch?.branches || [],
      ignoreAuthors: repo.watch?.['ignore-authors'] || [],
    },
    fix: {
      types: effectiveFixTypes === 'all' ? ALL_FAILURE_TYPES : effectiveFixTypes,
      maxFilesPerFix: repo.safety?.['max-files-per-fix'] || DEFAULT_MAX_FILES_PER_FIX,
    },
    merge: {
      enabled: repo.merge?.enabled ?? false,
      maxCommits: getOptionalPositiveInteger(repo.merge?.['max-commits'], 3, 'merge.max-commits'),
      requireLabel: repo.merge?.['require-label'] ?? true,
      protectedPatterns: repo.merge?.['protected-patterns'] || DEFAULT_PROTECTED_BRANCHES,
    },
    report: {
      prComment: repo.report?.['pr-comment'] ?? true,
      jobSummary: repo.report?.['job-summary'] ?? true,
      slackWebhook: repo.report?.['slack-webhook'] || null,
    },
    safety: {
      neverTouchFiles: repo.safety?.['never-touch-files'] || DEFAULT_NEVER_TOUCH_FILES,
      maxFilesPerFix: getOptionalPositiveInteger(
        repo.safety?.['max-files-per-fix'],
        DEFAULT_MAX_FILES_PER_FIX,
        'safety.max-files-per-fix',
      ),
      revertOnRegression: repo.safety?.['revert-on-regression'] ?? true,
    },
  };
}
