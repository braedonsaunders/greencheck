import { describe, expect, it } from 'vitest';
import { buildPrompt } from './agent';
import { AgentContext, FailureCluster } from './types';

function createContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    workflowRunId: 123,
    workflowName: 'CI',
    workflowUrl: 'https://github.com/example/repo/actions/runs/123',
    branch: 'main',
    headSha: 'abc123',
    parserUsed: 'none',
    logPath: '.greencheck/logs/workflow-run-123.log',
    rawLog: 'failing log output',
    parsedFailures: [],
    ...overrides,
  };
}

function createCluster(overrides: Partial<FailureCluster> = {}): FailureCluster {
  return {
    type: 'unknown',
    files: [],
    failures: [],
    strategy: 'llm',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('gives the agent repository-wide control with direct log access', () => {
    const prompt = buildPrompt(createContext(), createCluster());

    expect(prompt).toContain('Take control immediately');
    expect(prompt).toContain('You have repository-wide edit access');
    expect(prompt).toContain('`.greencheck/logs/workflow-run-123.log`');
    expect(prompt).not.toContain('Parsed hints from greencheck');
  });

  it('tells the agent to self-investigate from the raw workflow context', () => {
    const prompt = buildPrompt(createContext(), createCluster());

    expect(prompt).toContain('Open the saved workflow log file first and use it as source of truth');
    expect(prompt).toContain('Read the saved workflow log file yourself if it exists');
  });

  it('includes parsed failure hints when greencheck identified concrete files', () => {
    const prompt = buildPrompt(
      createContext({ parserUsed: 'pytest, ruff' }),
      createCluster({
        type: 'lint',
        files: ['backend/api/routes.py', 'backend/services/runtime.py'],
        failures: [
          {
            type: 'lint',
            file: 'backend/api/routes.py',
            line: 13,
            column: 24,
            message: 'unused import',
            rule: 'F401',
            rawLog: '',
            confidence: 0.95,
          },
        ],
      }),
    );

    expect(prompt).toContain('Parsed hints from greencheck');
    expect(prompt).toContain('Parser(s): pytest, ruff');
    expect(prompt).toContain('`backend/api/routes.py`');
    expect(prompt).toContain('`backend/api/routes.py:13:24` (F401): unused import');
  });
});
