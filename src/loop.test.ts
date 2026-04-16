import { describe, expect, it } from 'vitest';
import { buildAgentCluster, getFailureKey } from './loop';
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
    expect(cluster.files).toEqual(['backend/tests/test_signal_cursor.py']);
    expect(cluster.failures).toHaveLength(3);
  });

  it('caps a single oversized test cluster before it reaches the agent', () => {
    const logResult: LogParserResult = {
      failures: [
        {
          type: 'test-failure',
          file: 'backend/tests/test_trader_orchestrator_worker.py',
          line: null,
          column: null,
          message: 'worker failure 1',
          rule: null,
          rawLog: 'FAILED tests/test_trader_orchestrator_worker.py::test_one - worker failure 1',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_trader_orchestrator_worker.py',
          line: null,
          column: null,
          message: 'worker failure 2',
          rule: null,
          rawLog: 'FAILED tests/test_trader_orchestrator_worker.py::test_two - worker failure 2',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_trader_orchestrator_worker.py',
          line: null,
          column: null,
          message: 'worker failure 3',
          rule: null,
          rawLog: 'FAILED tests/test_trader_orchestrator_worker.py::test_three - worker failure 3',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_trader_orchestrator_worker.py',
          line: null,
          column: null,
          message: 'worker failure 4',
          rule: null,
          rawLog: 'FAILED tests/test_trader_orchestrator_worker.py::test_four - worker failure 4',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_trader_orchestrator_worker.py',
          line: null,
          column: null,
          message: 'worker failure 5',
          rule: null,
          rawLog: 'FAILED tests/test_trader_orchestrator_worker.py::test_five - worker failure 5',
          confidence: 0.95,
        },
        {
          type: 'test-failure',
          file: 'backend/tests/test_trader_orchestrator_worker.py',
          line: null,
          column: null,
          message: 'worker failure 6',
          rule: null,
          rawLog: 'FAILED tests/test_trader_orchestrator_worker.py::test_six - worker failure 6',
          confidence: 0.95,
        },
      ],
      rawLog: 'raw log',
      parserUsed: 'pytest',
      logPath: '.greencheck/logs/run.log',
    };

    const cluster = buildAgentCluster(logResult, createConfig(10));

    expect(cluster.files).toEqual(['backend/tests/test_trader_orchestrator_worker.py']);
    expect(cluster.failures).toHaveLength(3);
    expect(cluster.failures.map((failure) => failure.message)).toEqual([
      'worker failure 1',
      'worker failure 2',
      'worker failure 3',
    ]);
  });
});

describe('getFailureKey', () => {
  it('uses the stable pytest test identity instead of volatile assertion text', () => {
    const first = getFailureKey({
      type: 'test-failure',
      file: 'backend/tests/test_trader_signal_cursor_scanning.py',
      line: null,
      column: null,
      message: "assert ['abc123'] == ['def456']",
      rule: null,
      rawLog: "FAILED tests/test_trader_signal_cursor_scanning.py::test_unconsumed_signals_default_to_pending_and_use_cursor - AssertionError: assert ['abc123'] == ['def456']",
      confidence: 0.7,
    });
    const second = getFailureKey({
      type: 'test-failure',
      file: 'backend/tests/test_trader_signal_cursor_scanning.py',
      line: null,
      column: null,
      message: "assert ['xyz789'] == ['uvw000']",
      rule: null,
      rawLog: "FAILED tests/test_trader_signal_cursor_scanning.py::test_unconsumed_signals_default_to_pending_and_use_cursor - AssertionError: assert ['xyz789'] == ['uvw000']",
      confidence: 0.7,
    });

    expect(first).toBe('test:tests/test_trader_signal_cursor_scanning.py::test_unconsumed_signals_default_to_pending_and_use_cursor');
    expect(second).toBe(first);
  });

  it('keeps distinct pytest test cases separate even within the same file', () => {
    const first = getFailureKey({
      type: 'test-failure',
      file: 'backend/tests/test_market_runtime_reactive_reference_updates.py',
      line: null,
      column: null,
      message: 'assert 2 == 3',
      rule: null,
      rawLog: 'FAILED tests/test_market_runtime_reactive_reference_updates.py::test_refresh_event_catalog_skips_full_reload_when_catalog_unchanged - AssertionError: assert 2 == 3',
      confidence: 0.7,
    });
    const second = getFailureKey({
      type: 'test-failure',
      file: 'backend/tests/test_market_runtime_reactive_reference_updates.py',
      line: null,
      column: null,
      message: 'assert None is not None',
      rule: null,
      rawLog: 'FAILED tests/test_market_runtime_reactive_reference_updates.py::test_run_loop_iteration_schedules_catalog_refresh_without_waiting - assert None is not None',
      confidence: 0.7,
    });

    expect(first).not.toBe(second);
  });
});
