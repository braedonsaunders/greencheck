import { describe, expect, it } from 'vitest';
import { buildAgentCluster } from './loop';
import { GreenCheckConfig, LogParserResult } from './types';

function createConfig(maxFilesPerFix = 10): GreenCheckConfig {
  return {
    agent: 'claude',
    agentApiKey: 'test-key',
    agentOAuthToken: null,
    githubToken: 'gh-token',
    triggerToken: 'trigger-token',
    maxPasses: 5,
    maxCostCents: 300,
    timeoutMs: 20 * 60 * 1000,
    autoMerge: false,
    watchWorkflows: [],
    fixTypes: 'all',
    model: null,
    dryRun: false,
    configPath: '.greencheck.yml',
    watch: {
      workflows: [],
      branches: [],
      ignoreAuthors: [],
    },
    fix: {
      types: ['lint', 'type-error', 'test-failure', 'build-error', 'runtime-error'],
      maxFilesPerFix,
    },
    merge: {
      enabled: false,
      maxCommits: 3,
      requireLabel: true,
      protectedPatterns: ['main'],
    },
    report: {
      prComment: true,
      jobSummary: true,
      slackWebhook: null,
    },
    safety: {
      neverTouchFiles: ['*.lock', 'package-lock.json', '.env*'],
      maxFilesPerFix,
      revertOnRegression: true,
    },
  };
}

describe('buildAgentCluster', () => {
  it('returns a repository-wide fallback when no parsed failures exist', () => {
    const cluster = buildAgentCluster(
      {
        failures: [],
        rawLog: 'raw log',
        parserUsed: 'none',
        logPath: '.greencheck/logs/run.log',
      },
      createConfig(),
    );

    expect(cluster.type).toBe('unknown');
    expect(cluster.files).toEqual([]);
    expect(cluster.failures).toEqual([]);
  });

  it('merges same-type prioritized clusters up to the file limit', () => {
    const logResult: LogParserResult = {
      failures: [
        {
          type: 'lint',
          file: 'src/a.ts',
          line: 1,
          column: 1,
          message: 'unused variable',
          rule: 'no-unused-vars',
          rawLog: '',
          confidence: 0.95,
        },
        {
          type: 'lint',
          file: 'lib/b.ts',
          line: 2,
          column: 1,
          message: 'missing semicolon',
          rule: 'semi',
          rawLog: '',
          confidence: 0.9,
        },
        {
          type: 'lint',
          file: 'tools/c.ts',
          line: 3,
          column: 1,
          message: 'unexpected console',
          rule: 'no-console',
          rawLog: '',
          confidence: 0.8,
        },
        {
          type: 'test-failure',
          file: 'tests/example.test.ts',
          line: 10,
          column: null,
          message: 'expected true to be false',
          rule: null,
          rawLog: '',
          confidence: 0.7,
        },
      ],
      rawLog: 'raw log',
      parserUsed: 'eslint, jest',
      logPath: '.greencheck/logs/run.log',
    };

    const cluster = buildAgentCluster(logResult, createConfig(2));

    expect(cluster.type).toBe('lint');
    expect(cluster.files).toEqual(['src/a.ts', 'lib/b.ts']);
    expect(cluster.failures).toHaveLength(2);
    expect(cluster.failures.every((failure) => failure.type === 'lint')).toBe(true);
  });

  it('caps merged test-failure clusters to a smaller batch', () => {
    const logResult: LogParserResult = {
      failures: [
        {
          type: 'test-failure',
          file: 'backend/tests/test_signal_cursor.py',
          line: 10,
          column: null,
          message: 'cursor failure 1',
          rule: null,
          rawLog: '',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_signal_cursor.py',
          line: 20,
          column: null,
          message: 'cursor failure 2',
          rule: null,
          rawLog: '',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_signal_cursor.py',
          line: 30,
          column: null,
          message: 'cursor failure 3',
          rule: null,
          rawLog: '',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_signal_cursor.py',
          line: 40,
          column: null,
          message: 'cursor failure 4',
          rule: null,
          rawLog: '',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_routes.py',
          line: 50,
          column: null,
          message: 'routes failure',
          rule: null,
          rawLog: '',
          confidence: 0.8,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_tradability.py',
          line: 60,
          column: null,
          message: 'tradability failure',
          rule: null,
          rawLog: '',
          confidence: 0.7,
        },
      ],
      rawLog: 'raw log',
      parserUsed: 'pytest',
      logPath: '.greencheck/logs/run.log',
    };

    const cluster = buildAgentCluster(logResult, createConfig(10));

    expect(cluster.type).toBe('test-failure');
    expect(cluster.files).toEqual([
      'backend/tests/test_signal_cursor.py',
      'backend/tests/test_routes.py',
    ]);
    expect(cluster.failures).toHaveLength(5);
  });
});
